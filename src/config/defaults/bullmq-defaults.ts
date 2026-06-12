import type { JobsOptions } from "bullmq";

/**
 * Defaults operacionais da fila BullMQ de processamento de mensagens.
 * Internos e documentados — sem env vars (o desafio não exige tuning externo);
 * centralizados aqui para não espalhar números mágicos por Queue/Worker.
 */

/** Tentativas por job antes de ir para "failed" (inclui a 1ª execução). */
export const BULLMQ_JOB_ATTEMPTS = 5;
/** Atraso base (ms) do backoff exponencial entre tentativas. */
export const BULLMQ_BACKOFF_DELAY_MS = 3_000;
/** Retém jobs concluídos por até 24h (em segundos)... */
export const BULLMQ_REMOVE_ON_COMPLETE_AGE_SECONDS = 60 * 60 * 24;
/** ...e no máximo este número deles. */
export const BULLMQ_REMOVE_ON_COMPLETE_COUNT = 1_000;
/** Retém os últimos N jobs que falharam, para inspeção. */
export const BULLMQ_REMOVE_ON_FAIL_COUNT = 1_000;

/** `JobsOptions` padrão aplicado a todo job enfileirado na fila. */
export const messageProcessingJobOptions: JobsOptions = {
  attempts: BULLMQ_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: BULLMQ_BACKOFF_DELAY_MS },
  removeOnComplete: {
    age: BULLMQ_REMOVE_ON_COMPLETE_AGE_SECONDS,
    count: BULLMQ_REMOVE_ON_COMPLETE_COUNT,
  },
  removeOnFail: {
    count: BULLMQ_REMOVE_ON_FAIL_COUNT,
  },
};
