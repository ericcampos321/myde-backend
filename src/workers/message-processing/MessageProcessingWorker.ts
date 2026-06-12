import {
  QueueEvents,
  Worker,
  type Job,
} from "bullmq";
import { pathToFileURL } from "node:url";
import {
  WORKER_AUTORUN,
  WORKER_CONCURRENCY,
  WORKER_LOCK_DURATION_MS,
  WORKER_MAX_STALLED_COUNT,
  WORKER_STALLED_INTERVAL_MS,
} from "../../config/defaults/worker-defaults.js";
import { getRedisConnectionOptions } from "../../infrastructure/index.js";
import { closeDb } from "../../db/client.js";
import { createLogger } from "../../shared/logger/logger.js";
import { createAiResponseService } from "../../services/tenant/ai/index.js";
import {
  MessageProcessingProcessor,
  createMessageProcessingProcessor,
  type MessageProcessingProcessorDependencies,
} from "../../services/tenant/message-processing/MessageProcessingProcessor.js";
import {
  closeMessageProcessingQueue,
  MESSAGE_PROCESSING_QUEUE,
  PROCESS_INBOUND_MESSAGE_JOB,
  type MessageProcessingJobPayload,
  type MessageProcessingResult,
} from "../../queues/message-processing/index.js";
import { installWorkerShutdown } from "./MessageProcessingWorkerRuntime.js";

export interface MessageProcessingWorkerDependencies
  extends MessageProcessingProcessorDependencies {
  concurrency?: number;
  autorun?: boolean;
  processor?: Pick<MessageProcessingProcessor, "processMessageJob">;
}


export async function createMessageProcessingWorker(
  dependencies: MessageProcessingWorkerDependencies = {}
): Promise<{
  worker: Worker<MessageProcessingJobPayload, MessageProcessingResult>;
  queueEvents: QueueEvents;
  close: () => Promise<void>;
}> {
  const processor =
    dependencies.processor ?? createMessageProcessingProcessor(dependencies);
  const log = createLogger({ module: "worker", queue: MESSAGE_PROCESSING_QUEUE });
  const connection = getRedisConnectionOptions();
  const worker = new Worker<
    MessageProcessingJobPayload,
    MessageProcessingResult
  >(
    MESSAGE_PROCESSING_QUEUE,
    async (job) => {
      log.info(
        {
          jobId: job.id,
          tenantId: job.data.tenantId,
          conversationId: job.data.conversationId,
          messageId: job.data.messageId,
          externalMessageId: job.data.externalMessageId,
          attemptsMade: job.attemptsMade,
        },
        "worker processing inbound message"
      );

      return processor.processMessageJob(job.data);
    },
    {
      connection,
      autorun: dependencies.autorun ?? WORKER_AUTORUN,
      concurrency: dependencies.concurrency ?? WORKER_CONCURRENCY,
      lockDuration: WORKER_LOCK_DURATION_MS,
      stalledInterval: WORKER_STALLED_INTERVAL_MS,
      maxStalledCount: WORKER_MAX_STALLED_COUNT,
    }
  );

  const queueEvents = new QueueEvents(MESSAGE_PROCESSING_QUEUE, { connection });

  worker.on("completed", (job: Job<MessageProcessingJobPayload>, result) => {
    log.info(
      {
        jobId: job.id,
        tenantId: job.data.tenantId,
        conversationId: job.data.conversationId,
        messageId: job.data.messageId,
        externalMessageId: job.data.externalMessageId,
        processed: result.processed,
        aiSource: result.aiSource,
        skipped: result.skipped,
        reason: result.reason,
      },
      "worker job completed"
    );
  });

  worker.on("failed", (job, error) => {
    log.error(
      {
        err: error,
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        conversationId: job?.data.conversationId,
        messageId: job?.data.messageId,
        externalMessageId: job?.data.externalMessageId,
        attemptsMade: job?.attemptsMade,
      },
      "worker job failed"
    );
  });

  worker.on("error", (error) => {
    log.error({ err: error }, "worker error");
  });

  queueEvents.on("stalled", ({ jobId }) => {
    log.warn({ jobId }, "worker job stalled");
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await queueEvents.close();
  };

  return { worker, queueEvents, close };
}

async function bootstrap(): Promise<void> {
  const log = createLogger({ module: "worker", queue: MESSAGE_PROCESSING_QUEUE });
  const aiResponseService = createAiResponseService();
  log.info(
    {
      jobName: PROCESS_INBOUND_MESSAGE_JOB,
      concurrency: WORKER_CONCURRENCY,
      aiProvider: aiResponseService.source,
    },
    "worker de processamento iniciado"
  );

  const runtime = await createMessageProcessingWorker({
    aiResponseService,
  });

  installWorkerShutdown(log, async () => {
    await runtime.close();
    await closeMessageProcessingQueue();
    await closeDb();
  });
}

const entrypointArg = process.argv[1];
if (entrypointArg) {
  const isEntrypoint =
    import.meta.url === pathToFileURL(entrypointArg).href;
  if (isEntrypoint) {
    void bootstrap();
  }
}
