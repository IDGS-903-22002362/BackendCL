/**
 * Infraestructura compartida por todas las tools del Asistente Administrativo.
 *
 * Se extrajo de `analytics.tools.ts` para que las tools de comportamiento
 * (trafico, funnel, forecast, anomalias) reutilicen exactamente el mismo
 * contexto, la misma cache por request y la misma resolucion de periodos, en
 * lugar de crear una arquitectura paralela.
 */

import { z } from "zod";
import { RolUsuario } from "../../../models/usuario.model";
import analyticsRepository, {
  AnalyticsOrdersPage,
  AnalyticsProduct,
} from "./analytics.repository";
import behaviorRepository, {
  AnalyticsBehaviorPage,
  BEHAVIOR_EVENT_TYPES,
  BehaviorEventType,
} from "./behavior.repository";
import {
  ANALYTICS_PERIOD_KEYS,
  ResolvedPeriod,
  resolvePeriod,
} from "./period.util";

export interface AnalyticsToolContext {
  userId: string;
  role: RolUsuario;
  requestId?: string;
  now: Date;
  /** Cache por request para no repetir la misma lectura de Firestore. */
  cache: Map<string, Promise<unknown>>;
}

export interface AnalyticsTool {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (
    input: Record<string, unknown>,
    context: AnalyticsToolContext,
  ) => Promise<Record<string, unknown>>;
}

export const createAnalyticsToolContext = (input: {
  userId: string;
  role: RolUsuario;
  requestId?: string;
  now?: Date;
}): AnalyticsToolContext => ({
  userId: input.userId,
  role: input.role,
  requestId: input.requestId,
  now: input.now || new Date(),
  cache: new Map(),
});

export const cached = async <T>(
  context: AnalyticsToolContext,
  key: string,
  loader: () => Promise<T>,
): Promise<T> => {
  const existing = context.cache.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = loader();
  context.cache.set(key, promise as Promise<unknown>);
  return promise;
};

export const periodShape = {
  period: z
    .enum(ANALYTICS_PERIOD_KEYS)
    .describe(
      'Periodo a consultar. Usa "custom" solo cuando el usuario da fechas exactas.',
    ),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Fecha inicial YYYY-MM-DD. Requerida solo si period="custom".'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      'Fecha final YYYY-MM-DD inclusiva. Requerida solo si period="custom".',
    ),
};

export const resolveFromInput = (
  input: Record<string, unknown>,
  context: AnalyticsToolContext,
): ResolvedPeriod =>
  resolvePeriod(
    {
      period: input.period as never,
      from: input.from as string | undefined,
      to: input.to as string | undefined,
    },
    context.now,
  );

export const loadOrders = (
  context: AnalyticsToolContext,
  period: ResolvedPeriod,
): Promise<AnalyticsOrdersPage> =>
  cached(context, `orders:${period.fromDayKey}:${period.toDayKey}`, () =>
    analyticsRepository.listOrdersInPeriod(period),
  );

export const loadCatalogProducts = (
  context: AnalyticsToolContext,
): Promise<{ products: AnalyticsProduct[]; truncated: boolean }> =>
  cached(context, "products:all", () => analyticsRepository.listProducts());

export const loadCategories = (context: AnalyticsToolContext) =>
  cached(context, "categories", () => analyticsRepository.getCategories());

export const loadLines = (context: AnalyticsToolContext) =>
  cached(context, "lines", () => analyticsRepository.getLines());

export const loadBehaviorEvents = (
  context: AnalyticsToolContext,
  period: ResolvedPeriod,
  types: BehaviorEventType[] = [...BEHAVIOR_EVENT_TYPES],
): Promise<AnalyticsBehaviorPage> => {
  const key = `behavior:${period.fromDayKey}:${period.toDayKey}:${[...types]
    .sort()
    .join(",")}`;

  return cached(context, key, () =>
    behaviorRepository.listEventsInPeriod(period, types),
  );
};

export const loadEarliestEventDays = (
  context: AnalyticsToolContext,
  types: BehaviorEventType[],
): Promise<Record<string, string | null>> =>
  cached(context, `behavior:availability:${[...types].sort().join(",")}`, () =>
    behaviorRepository.getEarliestEventDays(types),
  );

export const buildDataQuality = (
  page: AnalyticsOrdersPage,
  period: ResolvedPeriod,
): Record<string, unknown> => {
  const withoutPaymentStatus = page.orders.filter(
    (order) => order.paymentStatus === null,
  ).length;

  const notes: string[] = [];

  if (page.truncated) {
    notes.push(
      "El periodo supera el limite de lectura del agente; los totales pueden estar incompletos.",
    );
  }

  if (withoutPaymentStatus > 0) {
    notes.push(
      `${withoutPaymentStatus} pedidos del periodo no tienen estado de pago registrado y no se cuentan como venta.`,
    );
  }

  if (page.orders.length === 0) {
    notes.push(`No se registraron pedidos en ${period.label}.`);
  }

  return {
    ordersScanned: page.orders.length,
    truncated: page.truncated,
    ordersWithoutPaymentStatus: withoutPaymentStatus,
    notes,
  };
};

export const productLabel = (
  productId: string,
  products: Map<string, AnalyticsProduct>,
): {
  name: string;
  sku: string;
  categoryId: string | null;
  lineId: string | null;
} => {
  const product = products.get(productId);

  return {
    name: product?.name || `Producto sin catalogo (${productId})`,
    sku: product?.sku || productId,
    categoryId: product?.categoriaId ?? null,
    lineId: product?.lineaId ?? null,
  };
};
