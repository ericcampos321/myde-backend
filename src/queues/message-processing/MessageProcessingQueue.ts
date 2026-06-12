import { Queue } from "bullmq";
import { messageProcessingJobOptions } from "../../config/defaults/bullmq-defaults.js";
import { getRedisConnectionOptions } from "../../infrastructure/index.js";
import { createLogger } from "../../shared/logger/logger.js";
import {
  MESSAGE_PROCESSING_QUEUE,
  PROCESS_INBOUND_MESSAGE_JOB,
  type EnqueueInboundMessageResult,
  type MessageProcessingJobPayload,
  type MessageProcessingQueuePort,
} from "./MessageProcessingQueueTypes.js";

const log = createLogger({
  module: "message-processing-queue",
  queue: MESSAGE_PROCESSING_QUEUE,
});

let messageProcessingQueue: Queue<MessageProcessingJobPayload> | null = null;

function getQueue(): Queue<MessageProcessingJobPayload> {
  if (!messageProcessingQueue) {
    messageProcessingQueue = new Queue(MESSAGE_PROCESSING_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: messageProcessingJobOptions,
    });
  }

  return messageProcessingQueue;
}

export class BullMqMessageProcessingQueue implements MessageProcessingQueuePort {
  async enqueueInboundMessage(
    payload: MessageProcessingJobPayload
  ): Promise<EnqueueInboundMessageResult> {
    const queue = getQueue();
    const job = await queue.add(PROCESS_INBOUND_MESSAGE_JOB, payload, {
      jobId: payload.externalMessageId,
    });

    log.info(
      {
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        externalMessageId: payload.externalMessageId,
        jobId: job.id,
      },
      "message processing job enqueued"
    );

    return {
      jobId: String(job.id),
      jobName: PROCESS_INBOUND_MESSAGE_JOB,
    };
  }
}

const bullMqMessageProcessingQueue = new BullMqMessageProcessingQueue();

export async function enqueueInboundMessage(
  payload: MessageProcessingJobPayload
): Promise<EnqueueInboundMessageResult> {
  return bullMqMessageProcessingQueue.enqueueInboundMessage(payload);
}

export async function closeMessageProcessingQueue(): Promise<void> {
  const queue = messageProcessingQueue;
  messageProcessingQueue = null;

  if (queue) {
    await queue.close();
  }
}
