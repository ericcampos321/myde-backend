import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { env } from "../../config/env.js";
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

function getRedisConnectionOptions(): ConnectionOptions {
  const redisUrl = new URL(env.REDIS_URL);
  const database =
    redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : undefined;
  const host = redisUrl.hostname === "localhost" ? "127.0.0.1" : redisUrl.hostname;

  return {
    host,
    port: redisUrl.port ? Number(redisUrl.port) : 6379,
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: Number.isNaN(database) ? undefined : database,
    maxRetriesPerRequest: null,
  };
}

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
