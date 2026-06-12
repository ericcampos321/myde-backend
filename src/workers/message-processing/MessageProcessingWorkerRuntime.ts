import type { Logger } from "pino";

type ShutdownFn = () => Promise<void>;

/**
 * Instala handlers de shutdown gracioso (SIGINT/SIGTERM) e de erros fatais
 * para um processo de worker. Garante que `shutdown` rode uma única vez.
 */
export function installWorkerShutdown(
  log: Logger,
  shutdown: ShutdownFn
): void {
  let shuttingDown = false;

  const run = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker recebendo sinal de shutdown");
    try {
      await shutdown();
      log.info("worker encerrado com sucesso");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "falha no shutdown do worker");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void run("SIGINT"));
  process.on("SIGTERM", () => void run("SIGTERM"));

  process.on("uncaughtException", (err) => {
    log.error({ err }, "uncaughtException no worker");
    void run("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    const isConnClosedDuringShutdown =
      shuttingDown &&
      reason instanceof Error &&
      reason.message.includes("Connection is closed");
    if (isConnClosedDuringShutdown) {
      log.warn("Connection closed durante shutdown — ignorado");
      return;
    }
    log.error({ reason }, "unhandledRejection no worker");
    void run("unhandledRejection");
  });
}
