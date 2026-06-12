import { Queue, type JobsOptions } from "bullmq";
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

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: {
    age: 60 * 60 * 24,
    count: 1000,
  },
  removeOnFail: {
    count: 1000,
  },
};

let messageProcessingQueue: Queue<MessageProcessingJobPayload> | null = null;


function getQueue(): Queue<MessageProcessingJobPayload> {
  if (!messageProcessingQueue) {
    messageProcessingQueue = new Queue(MESSAGE_PROCESSING_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions,
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
