import { Queue, type ConnectionOptions } from "bullmq";
import { messageProcessingJobOptions } from "../../config/defaults/bullmq-defaults.js";
import { getRedisConnectionOptions } from "../../infrastructure/index.js";
import { createLogger } from "../../shared/logger/logger.js";
import { LogEvents } from "../../shared/logger/events.js";
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

/**
 * Override APENAS para isolar testes de integração (Redis): permite que o teste use
 * uma fila própria (`queueName`), sem competir com o worker de dev/produção que
 * escuta a fila real. Em produção nada é passado → usa o singleton em
 * MESSAGE_PROCESSING_QUEUE (comportamento inalterado).
 */
export interface BullMqMessageProcessingQueueOptions {
  queueName?: string;
  connection?: ConnectionOptions;
}

export class BullMqMessageProcessingQueue implements MessageProcessingQueuePort {
  // Fila dedicada quando há override (teste); null = usa o singleton de produção.
  private readonly dedicatedQueue: Queue<MessageProcessingJobPayload> | null;

  constructor(options: BullMqMessageProcessingQueueOptions = {}) {
    this.dedicatedQueue = options.queueName
      ? new Queue(options.queueName, {
          connection: options.connection ?? getRedisConnectionOptions(),
          defaultJobOptions: messageProcessingJobOptions,
        })
      : null;
  }

  async enqueueInboundMessage(
    payload: MessageProcessingJobPayload
  ): Promise<EnqueueInboundMessageResult> {
    const queue = this.dedicatedQueue ?? getQueue();
    const startedAt = Date.now();
    const job = await queue.add(PROCESS_INBOUND_MESSAGE_JOB, payload, {
      jobId: payload.externalMessageId,
    });

    log.info(
      {
        event: LogEvents.messageProcessing.enqueued,
        correlationId: payload.externalMessageId,
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        externalMessageId: payload.externalMessageId,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
      },
      "message processing job enqueued"
    );

    return {
      jobId: String(job.id),
      jobName: PROCESS_INBOUND_MESSAGE_JOB,
    };
  }

  /**
   * Fecha a fila dedicada (teste). No-op quando a instância usa o singleton de
   * produção — esse é fechado por `closeMessageProcessingQueue` no shutdown.
   */
  async close(): Promise<void> {
    if (this.dedicatedQueue) {
      await this.dedicatedQueue.close();
    }
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
