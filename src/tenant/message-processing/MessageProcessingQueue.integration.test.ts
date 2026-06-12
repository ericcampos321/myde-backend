import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Queue } from "bullmq";
import { env } from "../../config/env.js";
import {
  BullMqMessageProcessingQueue,
  closeMessageProcessingQueue,
  createMessageProcessingWorker,
  MESSAGE_PROCESSING_QUEUE,
  PROCESS_INBOUND_MESSAGE_JOB,
} from "./index.js";

const runRedisTests = process.env.RUN_REDIS_TESTS === "true";
const describeRedis = runRedisTests ? describe : describe.skip;

let inspectionQueue: Queue | null = null;

beforeAll(() => {
  if (!runRedisTests) return;

  const redisUrl = new URL(env.REDIS_URL);
  const database =
    redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : undefined;
  const host = redisUrl.hostname === "localhost" ? "127.0.0.1" : redisUrl.hostname;
  inspectionQueue = new Queue(MESSAGE_PROCESSING_QUEUE, {
    connection: {
      host,
      port: redisUrl.port ? Number(redisUrl.port) : 6379,
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      db: Number.isNaN(database) ? undefined : database,
      maxRetriesPerRequest: null,
    },
  });
});

afterAll(async () => {
  if (!runRedisTests) return;
  await inspectionQueue?.close();
  await closeMessageProcessingQueue();
});

describeRedis("BullMqMessageProcessingQueue", () => {
  it("usa externalMessageId como jobId", async () => {
    const externalMessageId = `redis-test-${Date.now()}`;
    const queue = new BullMqMessageProcessingQueue();

    const result = await queue.enqueueInboundMessage({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId,
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    });

    const job = await inspectionQueue?.getJob(externalMessageId);

    expect(result).toEqual({
      jobId: externalMessageId,
      jobName: PROCESS_INBOUND_MESSAGE_JOB,
    });
    expect(job?.id).toBe(externalMessageId);
    expect(job?.name).toBe(PROCESS_INBOUND_MESSAGE_JOB);

    await job?.remove();
  });

  it("worker consome job real do redis com processor fake e fecha sem conexoes abertas", async () => {
    const externalMessageId = `redis-worker-test-${Date.now()}`;
    const queue = new BullMqMessageProcessingQueue();
    const processMessageJob = vi.fn().mockResolvedValue({
      processed: true,
      messageId: "message-1",
      conversationId: "conversation-1",
    });
    const controlledRuntime = await createMessageProcessingWorker({
      autorun: true,
      concurrency: 1,
      processor: {
        processMessageJob,
      } as never,
    });

    await queue.enqueueInboundMessage({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId,
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    });

    for (let attempt = 0; attempt < 20; attempt++) {
      if (processMessageJob.mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(processMessageJob).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId,
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    });

    const job = await inspectionQueue?.getJob(externalMessageId);
    await controlledRuntime.close();
    await job?.remove();
  }, 10000);
});
