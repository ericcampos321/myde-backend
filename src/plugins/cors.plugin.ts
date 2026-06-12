import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { corsOrigins } from "../config/env.js";

/** CORS explícito para o frontend local e requisições sem Origin (ex.: Meta). */
export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, corsOrigins.includes(origin));
    },
  });
}
