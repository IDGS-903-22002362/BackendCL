import { firestoreTienda } from "../../../config/firebase";
import { Orden } from "../../../models/orden.model";
import { LoyaltyActorType, LoyaltyChannel } from "../models/loyalty.enums";
import conversionRulesService from "../services/conversion-rules.service";
import loyaltyEngineService from "../services/loyalty-engine.service";
import ledgerRepository from "../repositories/ledger.repository";
import { externalTxnRepository } from "../repositories/idempotency.repository";

const ORDENES_COLLECTION = "ordenes";

const systemActor = {
  actorType: LoyaltyActorType.SERVICE,
  actorId: "payment-finalizer",
  roles: ["SERVICE"],
  permissions: [] as string[],
};

export async function earnLoyaltyPointsForPaidOrder(orderId: string): Promise<void> {
  const orderSnap = await firestoreTienda.collection(ORDENES_COLLECTION).doc(orderId).get();
  if (!orderSnap.exists) {
    return;
  }
  const order = orderSnap.data() as Orden;
  const memberId = order.usuarioId?.trim();
  if (!memberId) {
    return;
  }

  const totalPesos = Number(order.total ?? order.subtotal ?? 0);
  if (!Number.isFinite(totalPesos) || totalPesos <= 0) {
    return;
  }

  const amountCents = Math.round(totalPesos * 100);
  const externalTransactionId = `order:${orderId}`;
  const idempotencyKey = `earn:order:${orderId}`;

  await loyaltyEngineService.earnFromSale({
    memberId,
    externalTransactionId,
    amountCents,
    currency: "MXN",
    channel: LoyaltyChannel.ECOMMERCE,
    description: `Acumulacion por compra en linea ${orderId}`,
    idempotencyKey,
    actor: systemActor,
  });
}

export async function reverseLoyaltyPointsForRefund(
  orderId: string,
  refundAmountMinor?: number,
): Promise<void> {
  const extKey = conversionRulesService.buildExternalTxnKey(
    LoyaltyChannel.ECOMMERCE,
    `order:${orderId}`,
  );
  const ext = await externalTxnRepository.get(extKey);
  if (!ext?.transactionId) {
    return;
  }

  const original = await ledgerRepository.getById(ext.transactionId);
  if (!original || original.points <= 0) {
    return;
  }

  let pointsToReverse: number | undefined;
  if (typeof refundAmountMinor === "number" && Number.isFinite(refundAmountMinor) && refundAmountMinor > 0) {
    pointsToReverse = conversionRulesService.calculatePointsFromAmountCents(refundAmountMinor);
    if (pointsToReverse <= 0) {
      return;
    }
  }

  await loyaltyEngineService.reverseTransaction({
    originalTransactionId: original.transactionId,
    points: pointsToReverse,
    reason: `Reversion por reembolso de orden ${orderId}`,
    idempotencyKey: `refund:order:${orderId}:${refundAmountMinor ?? "full"}`,
    actor: systemActor,
  });
}
