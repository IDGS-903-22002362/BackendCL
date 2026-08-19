/**
 * Utilidades compartidas por los controladores del POS.
 *
 * Los controladores solo traducen HTTP a llamadas de servicio: el actor siempre viene del
 * token verificado (nunca del body), la idempotencia se resuelve en un único lugar y la
 * serialización se delega a `pos.serializers`.
 */

import { createHash } from "crypto";
import { Request, Response } from "express";
import PosProblemError from "../errors/pos-problem.error";
import type { PosActor, PosRequestContext } from "../models/pos.types";
import posIdempotencyService from "../services/pos-idempotency.service";
import posSettingsService from "../services/pos-settings.service";
import { toPosJson } from "./pos.serializers";

/** Actor POS resuelto por `posActorMiddleware`. */
export function requireActor(req: Request): PosActor {
  if (!req.posActor) {
    throw new PosProblemError("AUTHENTICATION_REQUIRED");
  }
  return req.posActor;
}

export function contextOf(req: Request): PosRequestContext | null {
  return req.posContext ?? null;
}

function requireIdempotencyKey(req: Request): string {
  const key = req.posIdempotencyKey ?? req.header("Idempotency-Key")?.trim();
  if (!key) {
    throw new PosProblemError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

/**
 * Hash de la clave de idempotencia para trazar movimientos y pagos.
 *
 * Se persiste el hash y no la clave: es un valor elegido por el cliente y no debe quedar en
 * claro en documentos históricos, pero sigue sirviendo para correlacionar reintentos.
 */
export function idempotencyKeyHashOf(req: Request): string | null {
  const key = req.posIdempotencyKey ?? req.header("Idempotency-Key")?.trim();
  return key ? createHash("sha256").update(key).digest("hex") : null;
}

/**
 * Ejecuta una operación crítica a lo más una vez por `Idempotency-Key`.
 *
 * El payload que se hashea incluye los parámetros de ruta además del body: la misma clave
 * reutilizada sobre otro recurso debe ser un conflicto explícito, no un replay.
 */
export async function runIdempotent<T>(
  req: Request,
  res: Response,
  input: {
    operation: string;
    resourceKey: string;
    statusCode?: number;
    execute: () => Promise<T>;
    serialize?: (value: T) => unknown;
  },
): Promise<void> {
  const actor = requireActor(req);
  const idempotencyKey = requireIdempotencyKey(req);
  const settings = await posSettingsService.get();

  const result = await posIdempotencyService.execute<unknown>({
    operation: input.operation,
    resourceKey: input.resourceKey,
    actorUid: actor.uid,
    idempotencyKey,
    payload: { params: req.params, body: req.body ?? null },
    ttlMs: settings.idempotencyTtlHours * 60 * 60 * 1000,
    execute: async () => {
      const value = await input.execute();
      const body = input.serialize
        ? input.serialize(value)
        : toPosJson(value);
      return { statusCode: input.statusCode ?? 200, body };
    },
  });

  res.setHeader("Idempotency-Replayed", result.replayed ? "true" : "false");
  res.status(result.statusCode).json(result.body);
}

/** Respuesta simple ya serializada. */
export function sendJson(
  res: Response,
  body: Record<string, unknown>,
  statusCode = 200,
): void {
  res.status(statusCode).json(body);
}
