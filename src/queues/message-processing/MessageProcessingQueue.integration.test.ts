import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "../../infrastructure/index.js";
import {
  BullMqMessageProcessingQueue,
  PROCESS_INBOUND_MESSAGE_JOB,
} from "./index.js";
import { createMessageProcessingWorker } from "../../workers/message-processing/MessageProcessingWorker.js";

const runRedisTests = process.env.RUN_REDIS_TESTS === "true";
const describeRedis = runRedisTests ? describe : describe.skip;

// Fila ISOLADA do teste: nome único por execução. Garante que o teste NÃO compete
// com o worker de dev/produção (que escuta MESSAGE_PROCESSING_QUEUE) — sem precisar
// parar processos manualmente. A limpeza (obliterate) atua só neste namespace.
const testQueueName = `message-processing-test-${Date.now()}`;

let inspectionQueue: Queue | null = null;
let queue: BullMqMessageProcessingQueue | null = null;

beforeAll(() => {
  if (!runRedisTests) return;

  inspectionQueue = new Queue(testQueueName, {
    connection: getRedisConnectionOptions(),
  });
  queue = new BullMqMessageProcessingQueue({ queueName: testQueueName });
});

afterAll(async () => {
  if (!runRedisTests) return;

  // Limpa SOMENTE a fila de teste (namespace único). Nunca toca a fila real.
  try {
    await inspectionQueue?.obliterate({ force: true });
  } catch {
    // best-effort: limpeza não deve mascarar o resultado dos testes.
  }
  await inspectionQueue?.close();
  await queue?.close();
});

describeRedis("BullMqMessageProcessingQueue (fila isolada de teste)", () => {
  it("usa externalMessageId como jobId", async () => {
    const externalMessageId = `redis-test-${Date.now()}`;

    const result = await queue!.enqueueInboundMessage({
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

  it("re-enqueue com o mesmo jobId NÃO duplica o job (idempotência do A-03)", async () => {
    const externalMessageId = `redis-idempotent-${Date.now()}`;
    const payload = {
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId,
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    };

    // 1ª entrega (novo) + re-entrega duplicada (reparo A-03): mesmo jobId.
    await queue!.enqueueInboundMessage(payload);
    await queue!.enqueueInboundMessage(payload);

    // O BullMQ mantém UM único job para o jobId; não há duplicação.
    const jobs = await inspectionQueue!.getJobs(["waiting", "delayed", "active"]);
    const matching = jobs.filter((job) => job.id === externalMessageId);
    expect(matching).toHaveLength(1);

    await inspectionQueue?.getJob(externalMessageId).then((job) => job?.remove());
  });

  it("worker consome job real do redis com processor fake e fecha sem conexoes abertas", async () => {
    const externalMessageId = `redis-worker-test-${Date.now()}`;
    const processMessageJob = vi.fn().mockResolvedValue({
      processed: true,
      messageId: "message-1",
      conversationId: "conversation-1",
    });
    const controlledRuntime = await createMessageProcessingWorker({
      queueName: testQueueName,
      autorun: true,
      concurrency: 1,
      processor: {
        processMessageJob,
      } as never,
    });

    await queue!.enqueueInboundMessage({
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
