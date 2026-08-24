import { LoyaltyChannel } from "../models/loyalty.enums";

/**
 * Namespace canónico de una venta del POS de concesiones dentro del ledger.
 *
 * El POS de concesiones sí tiene un identificador de venta estable (`ventaId`,
 * p. ej. `V-1787359777105`), a diferencia del flujo de QR de staff donde el
 * folio lo teclea un empleado y hay que namespaciarlo por sucursal/cliente.
 * Al derivar la clave solo del `ventaId` conseguimos que la acumulación en
 * vivo, el reproceso de la cola de pendientes y la reparación histórica
 * produzcan exactamente la misma clave y por tanto no dupliquen puntos.
 */
export const POS_SALE_EXTERNAL_PREFIX = "pos-sale";

/** Canal del ledger al que pertenecen las ventas del POS de concesiones. */
export const POS_SALE_CHANNEL = LoyaltyChannel.STORE;

const sanitizeVentaId = (ventaId: string): string =>
  ventaId.trim().replace(/\s+/g, " ");

export const buildPosSaleExternalTxnId = (ventaId: string): string =>
  `${POS_SALE_EXTERNAL_PREFIX}:${sanitizeVentaId(ventaId)}`;

export const isPosSaleExternalTxnId = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(`${POS_SALE_EXTERNAL_PREFIX}:`);

/** `pos-sale:V-123` -> `V-123`. Devuelve null si no es una clave POS. */
export const ventaIdFromPosSaleExternalTxnId = (
  externalTransactionId: unknown,
): string | null => {
  if (!isPosSaleExternalTxnId(externalTransactionId)) return null;
  const ventaId = externalTransactionId.slice(
    POS_SALE_EXTERNAL_PREFIX.length + 1,
  );
  return ventaId || null;
};

/** ID del movimiento legacy que escribió el fallback del POS: `pos_acc_<ventaId>`. */
export const buildPosAccumulationMovementDocId = (ventaId: string): string =>
  `pos_acc_${sanitizeVentaId(ventaId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;

export const POS_ACCUMULATION_MOVEMENT_PREFIX = "pos_acc_";
