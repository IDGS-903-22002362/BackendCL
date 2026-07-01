import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { RolUsuario } from "../../../models/usuario.model";
import { assignPointsBySaleSchema, assignUserPointsSchema } from "../../../middleware/validators/user-points.validator";
import { LoyaltyChannel } from "../models/loyalty.enums";
import ledgerRepository from "../repositories/ledger.repository";
import loyaltyEngineService from "../services/loyalty-engine.service";
import { buildActorContext } from "../services/loyalty-auth.service";
import { requireLegacyAdapters } from "../services/loyalty-feature-flags.service";

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
    res.status(500).json({ success: false, message: "Error al obtener puntos" });
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
    res.status(500).json({ success: false, message: "Error al obtener historial" });
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
    res.status(500).json({ success: false, message: "Error al asignar puntos" });
  }
}

export async function legacyAssignPointsBySale(req: Request, res: Response) {
  try {
    setDeprecation(res);
    const { id } = req.params;
    const body = assignPointsBySaleSchema.parse(req.body);
    const actor = buildActorContext({ uid: req.user!.uid, rol: req.user!.rol });
    const amountCents = Math.round(body.dinero * 100);
    const externalTransactionId =
      req.header("Idempotency-Key")?.trim() ??
      `legacy-sale:${id}:${amountCents}:${Date.now()}`;
    const txn = await loyaltyEngineService.earnFromSale({
      memberId: id,
      externalTransactionId,
      amountCents,
      currency: "MXN",
      channel: LoyaltyChannel.STORE,
      description: body.descripcion ?? `Puntos por venta de $${body.dinero}`,
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
        origenId: actor.actorId,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error al asignar puntos por venta",
    });
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
    const result = await ledgerRepository.listAdmin({
      limit: Math.min(Number(req.query.limit ?? 50), 100),
      cursor: req.query.cursor as string | undefined,
      actorId,
      channel: LoyaltyChannel.STORE,
    });
    res.status(200).json({
      success: true,
      data: result.items.map((t) => ({
        id: t.transactionId,
        usuarioId: t.memberId,
        puntos: t.points,
        descripcion: t.description,
        origenId: t.actorId,
        createdAt: t.createdAt.toDate().toISOString(),
      })),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: Boolean(result.nextCursor),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error al obtener historial" });
  }
}
