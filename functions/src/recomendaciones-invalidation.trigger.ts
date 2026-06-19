import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { STORE_FIRESTORE_DATABASE } from "./config/firestore.constants";
import { EstadoOrden, Orden } from "./models/orden.model";
import {
  extractPaidProductIdsFromOrder,
  isOrdenPagada,
} from "./services/recomendaciones/utils/order-paid.util";
import invalidationService from "./services/recomendaciones/invalidation.service";

const triggerOptions = {
  database: STORE_FIRESTORE_DATABASE,
  region: process.env.GCP_REGION || "us-central1",
  memory: "256MiB" as const,
  timeoutSeconds: 120,
};

const PRODUCT_RELEVANT_FIELDS = [
  "activo",
  "disponible",
  "precioPublico",
  "categoriaId",
  "lineaId",
  "nombre",
  "visible",
];

const OFFER_RELEVANT_FIELDS = [
  "estado",
  "fechaInicio",
  "fechaFin",
  "productoIds",
  "categoriaIds",
  "lineaIds",
  "valorDescuento",
  "tipoDescuento",
];

function hasRelevantFieldChange(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  fields: string[],
): boolean {
  if (!before || !after) {
    return true;
  }

  return fields.some((field) => before[field] !== after[field]);
}

function getOrderUsuarioId(order: Orden | undefined): string | undefined {
  const usuarioId = order?.usuarioId;
  return typeof usuarioId === "string" && usuarioId.trim() ? usuarioId.trim() : undefined;
}

async function handleOrderInvalidation(before: Orden | undefined, after: Orden | undefined) {
  const wasPaid = before ? isOrdenPagada(before) : false;
  const isPaid = after ? isOrdenPagada(after) : false;
  const wasCancelled = before?.estado === EstadoOrden.CANCELADA;
  const isCancelled = after?.estado === EstadoOrden.CANCELADA;

  const paymentChanged = wasPaid !== isPaid;
  const cancellationChanged = wasCancelled !== isCancelled;

  if (!paymentChanged && !cancellationChanged) {
    return;
  }

  const sourceOrder = after ?? before;
  const usuarioId = getOrderUsuarioId(sourceOrder);
  const productoIds = sourceOrder ? extractPaidProductIdsFromOrder(sourceOrder) : [];

  await invalidationService.invalidateForPaidOrCancelledOrder({
    usuarioId,
    productoIds,
  });

  logger.info("recommendations_cache_invalidated_for_order", {
    usuarioId,
    productoIdsCount: productoIds.length,
    wasPaid,
    isPaid,
    wasCancelled,
    isCancelled,
  });
}

export const invalidateRecommendationsOnOrderChange = onDocumentWritten(
  {
    ...triggerOptions,
    document: "ordenes/{ordenId}",
  },
  async (event) => {
    if (!event.data?.before?.exists && !event.data?.after?.exists) {
      return;
    }

    const before = event.data?.before?.exists
      ? (event.data.before.data() as Orden)
      : undefined;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Orden)
      : undefined;

    await handleOrderInvalidation(before, after);
  },
);

export const invalidateRecommendationsOnProductChange = onDocumentWritten(
  {
    ...triggerOptions,
    document: "productos/{productoId}",
  },
  async (event) => {
    const productoId = event.params.productoId;
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    if (!after && before) {
      await invalidationService.invalidateForProductChange(productoId);
      logger.info("recommendations_cache_invalidated_for_deleted_product", { productoId });
      return;
    }

    if (!hasRelevantFieldChange(before, after, PRODUCT_RELEVANT_FIELDS)) {
      return;
    }

    await invalidationService.invalidateForProductChange(productoId);
    logger.info("recommendations_cache_invalidated_for_product", { productoId });
  },
);

export const invalidateRecommendationsOnInventoryChange = onDocumentCreated(
  {
    ...triggerOptions,
    document: "movimientosInventario/{movimientoId}",
  },
  async (event) => {
    const data = event.data?.data() as { productoId?: string } | undefined;
    const productoId = typeof data?.productoId === "string" ? data.productoId.trim() : "";

    if (!productoId) {
      return;
    }

    await invalidationService.invalidateForInventoryChange(productoId);
    logger.info("recommendations_cache_invalidated_for_inventory", {
      productoId,
      movimientoId: event.params.movimientoId,
    });
  },
);

export const invalidateRecommendationsOnOfferChange = onDocumentWritten(
  {
    ...triggerOptions,
    document: "ofertas/{ofertaId}",
  },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    if (!hasRelevantFieldChange(before, after, OFFER_RELEVANT_FIELDS)) {
      return;
    }

    await invalidationService.invalidateForOfferChange();
    logger.info("recommendations_cache_invalidated_for_offer", {
      ofertaId: event.params.ofertaId,
    });
  },
);

export const invalidateRecommendationsOnConfigChange = onDocumentWritten(
  {
    ...triggerOptions,
    document: "recomendacionConfig/{configId}",
  },
  async (event) => {
    if (!event.data?.after?.exists) {
      return;
    }

    await invalidationService.invalidateForConfigChange();
    logger.info("recommendations_cache_invalidated_for_config", {
      configId: event.params.configId,
    });
  },
);
