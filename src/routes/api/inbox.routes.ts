import type { FastifyInstance } from "fastify";
import {
  inboxController,
  type InboxControllerOptions,
} from "../../controllers/api/inbox/index.js";

export interface InboxRoutesOptions {
  inboxService?: InboxControllerOptions["inboxService"];
}

/** Rotas REST da inbox consumidas pelo frontend real. */
export async function inboxRoutes(
  app: FastifyInstance,
  options: InboxRoutesOptions = {}
): Promise<void> {
  await app.register(inboxController, {
    inboxService: options.inboxService,
  });
}
