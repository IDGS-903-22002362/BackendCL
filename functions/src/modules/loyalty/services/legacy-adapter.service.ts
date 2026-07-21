import { Request, Response } from "express";
import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { ZodError } from "zod";
import { RolUsuario } from "../../../models/usuario.model";
import { assignPointsBySaleSchema, assignUserPointsSchema } from "../../../middleware/validators/user-points.validator";
import LoyaltyProblemError from "../errors/loyalty-problem.error";
import { LoyaltyChannel } from "../models/loyalty.enums";
import ledgerRepository from "../repositories/ledger.repository";
import loyaltyEngineService from "../services/loyalty-engine.service";
import { buildActorContext } from "../services/loyalty-auth.service";
import { requireLegacyAdapters } from "../services/loyalty-feature-flags.service";
import { toDayKey } from "../../../utils/day-key.util";
import staffAssignmentHistoryService from "./staff-assignment-history.service";

/**
 * Mapea errores del Loyalty Engine al contrato legacy `{ success, message }`
 * conservando el status HTTP correcto en lugar de un 500 genérico.
 */
function sendLegacyError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof LoyaltyProblemError) {
    res.status(error.status).json({ success: false, message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Datos de la solicitud inválidos",
    });
    return;
  }
  res.status(500).json({ success: false, message: fallbackMessage });
}

function logLegacyUse(req: Request, endpoint: string, status: number): void {
  logger.info("legacy_loyalty_endpoint_used", {
    endpoint,
    status,
    actorId: req.user?.uid,
    actorRole: req.user?.rol,
  });
}

function setDeprecation(res: Response): void {
  res.set("Deprecation", "true");
  res.set("Sunset", "2026-09-30");
  res.set("Link", '</api/loyalty/v1/earn-transactions>; rel="successor-version"');
}

function saleNamespacePart(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex").slice(0, 12);
}

export async function legacyGetMyPoints(req: Request, res: Response) {
  try {
    await requireLegacyAdapters();
    setDeprecation(res);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    const wallet = await loyaltyEngineService.getWallet(actor.actorId);
    const dto = {
      success: true,
      puntos: wallet.availablePoints,
      nivel: wallet.level,
      cicloActual: 1,
      proximaExpiracionProgramada: wallet.nextExpirationAt
        ? { _seconds: Math.floor(wallet.nextExpirationAt.toDate().getTime() / 1000) }
        : undefined,
    };
    res.status(200).json(dto);
    logLegacyUse(req, "GET /me/getpuntos", 200);
  } catch (error) {
    logLegacyUse(req, "GET /me/getpuntos", 500);
    sendLegacyError(res, error, "Error al obtener puntos");
  }
}

export async function legacySumarStreakPoints(req: Request, res: Response) {
  try {
    await requireLegacyAdapters();
    setDeprecation(res);
    const uid = req.user!.uid;
    const dayKey = toDayKey(new Date(), "America/Mexico_City");
    await loyaltyEngineService.applyDailyStreakBonus(uid, dayKey);
    const wallet = await loyaltyEngineService.getWallet(uid);
    res.status(200).json({
      success: true,
      puntos: wallet.availablePoints,
      data: {
        puntosActuales: wallet.availablePoints,
      },
    });
    logLegacyUse(req, "POST /me/puntos/sumar", 200);
  } catch (error) {
    logLegacyUse(req, "POST /me/puntos/sumar", 500);
    sendLegacyError(res, error, "Error al sumar puntos");
  }
}

export async function legacyGetMyHistorial(req: Request, res: Response) {
  try {
    setDeprecation(res);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    const wallet = await loyaltyEngineService.getWallet(actor.actorId);
    const { items } = await ledgerRepository.listByMember(actor.actorId, { limit: 50 });
    res.status(200).json({
      success: true,
      data: {
        usuario: { puntosActuales: wallet.availablePoints, nivel: wallet.level },
        movimientosRecientes: items.map((t) => ledgerRepository.toResponseDto(t)),
      },
    });
  } catch (error) {
    sendLegacyError(res, error, "Error al obtener historial");
  }
}

export async function legacyAssignPoints(req: Request, res: Response) {
  try {
    setDeprecation(res);
    const { id } = req.params;
    const body = assignUserPointsSchema.parse(req.body);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    const txn = await loyaltyEngineService.applyAdjustment({
      memberId: id,
      points: body.points,
      reasonCode: "MANUAL_CORRECTION",
      description: body.descripcion ?? "Asignación manual de puntos",
      externalReference: `legacy-assign:${id}:${Date.now()}`,
      idempotencyKey: req.header("Idempotency-Key")?.trim() ??
        `legacy-assign:${id}:${body.points}:${body.descripcion ?? ""}`,
      actor,
    });
    res.status(200).json({
      success: true,
      message: "Puntos asignados exitosamente",
      data: {
        id,
        puntosAsignados: body.points,
        puntosActuales: txn.balanceAfter,
        descripcion: body.descripcion,
        origenId: actor.actorId,
      },
    });
  } catch (error) {
    sendLegacyError(res, error, "Error al asignar puntos");
  }
}

export async function legacyAssignPointsBySale(req: Request, res: Response) {
  try {
    setDeprecation(res);
    const { id } = req.params;
    const body = assignPointsBySaleSchema.parse(req.body);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    if (body.folioVenta.toLowerCase() === id.trim().toLowerCase()) {
      res.status(400).json({
        success: false,
        message: "El folio de venta debe ser distinto del ID del cliente",
      });
      return;
    }
    const amountCents = Math.round(body.dinero * 100);
    // El namespace evita colisiones del mismo folio entre empleados/tiendas y clientes.
    // El folio capturado se conserva sin adornos en metadata para consulta/auditoria.
    const rawLocationScope = String(
      req.user!.sucursalId ?? req.user!.concesionId ?? actor.actorId,
    ).trim();
    const locationScope = rawLocationScope.slice(0, 120) || actor.actorId;
    const externalTransactionId =
      `staff-sale:${saleNamespacePart(locationScope)}:${saleNamespacePart(id)}:${body.folioVenta}`;
    const txn = await loyaltyEngineService.earnFromSale({
      memberId: id,
      externalTransactionId,
      amountCents,
      currency: "MXN",
      channel: LoyaltyChannel.STORE,
      locationId: locationScope,
      description: body.descripcion ?? `Puntos por venta de $${body.dinero}`,
      metadata: {
        saleId: body.folioVenta,
        source: "staff-qr",
      },
      idempotencyKey: externalTransactionId,
      actor,
    });
    res.status(200).json({
      success: true,
      message: "Puntos asignados exitosamente por monto de venta",
      data: {
        id,
        montoVenta: body.dinero,
        puntosAsignados: txn.points,
        puntosActuales: txn.balanceAfter,
        descripcion: body.descripcion,
        folioVenta: body.folioVenta,
        externalTransactionId: txn.externalTransactionId,
        origenId: actor.actorId,
      },
    });
  } catch (error) {
    sendLegacyError(res, error, "Error al asignar puntos por venta");
  }
}

export async function legacyGetAsignaciones(req: Request, res: Response) {
  try {
    setDeprecation(res);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    const actorId =
      req.user!.rol === RolUsuario.ADMIN && req.query.empleadoId
        ? String(req.query.empleadoId)
        : actor.actorId;
    const result = await staffAssignmentHistoryService.list({
      limit: Math.min(Number(req.query.limit ?? 20), 50),
      cursor: req.query.cursor as string | undefined,
      actorId,
      search: req.query.search as string | undefined,
    });
    res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: Boolean(result.nextCursor),
        searchWindowLimited: result.searchWindowLimited,
        scannedCount: result.scannedCount,
      },
    });
  } catch (error) {
    sendLegacyError(res, error, "Error al obtener historial");
  }
}
