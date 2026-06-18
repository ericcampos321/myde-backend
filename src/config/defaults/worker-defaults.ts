/**
 * Defaults operacionais do worker BullMQ. Internos e documentados.
 *
 * `lockDuration`, `stalledInterval` e `maxStalledCount` são iguais aos defaults
 * do BullMQ — explicitados aqui para tornar o lifecycle de jobs travados
 * previsível e auto-documentado (sem alterar o comportamento padrão).
 */

/** Jobs processados em paralelo por instância de worker. */
export const WORKER_CONCURRENCY = 5;
/** Worker começa a consumir assim que é criado (vs. start manual). */
export const WORKER_AUTORUN = true;
/** Tempo (ms) que o worker mantém o lock de um job em processamento. */
export const WORKER_LOCK_DURATION_MS = 30_000;
/** Intervalo (ms) de checagem de jobs travados (stalled). */
export const WORKER_STALLED_INTERVAL_MS = 30_000;
/** Quantas vezes um job pode "stallar" antes de ser marcado como falho. */
export const WORKER_MAX_STALLED_COUNT = 1;
