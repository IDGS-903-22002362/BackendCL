/**
 * Funciones puras de agregacion de comportamiento (trafico, funnel, interes
 * por producto y origen de trafico) para el Asistente Administrativo.
 *
 * Se mantienen separadas del repositorio para poder probarlas sin Firestore y
 * para que todas las tools compartan exactamente la misma definicion de
 * "visita", "sesion", "vista de producto" y "conversion".
 *
 * Regla dura de unidades: nunca se mezclan sesiones con eventos ni eventos con
 * pedidos sin decirlo. Cada metrica declara su numerador y su denominador en
 * METRIC_DEFINITIONS y las tools envian esas definiciones junto al resultado.
 */

import {
  AnalyticsBehaviorEvent,
  AnalyticsBehaviorPage,
  BehaviorEventType,
} from "./behavior.repository";
import { ResolvedPeriod, describeWeekday, listDayKeys } from "./period.util";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Definiciones publicadas junto a cada resultado para evitar ambiguedad. */
export const METRIC_DEFINITIONS: Record<string, string> = {
  visits:
    "Numero de eventos page_view registrados en el periodo (vistas de pagina, no visitantes).",
  sessions:
    "Sesiones distintas con al menos un evento registrado en el periodo (identificador de sesion first-party).",
  visitors:
    "Visitantes distintos (pseudonimos) con al menos un evento en el periodo. Un mismo visitante puede tener varias sesiones.",
  productViews:
    "Eventos product_view del periodo. Un mismo visitante puede generar varias vistas del mismo producto.",
  addToCartEvents: "Eventos add_to_cart del periodo.",
  checkoutStarted: "Eventos checkout_started del periodo.",
  purchases:
    "Compras distintas registradas en telemetria, deduplicadas por id de orden.",
  visitToProductViewRate:
    "Sesiones con al menos una vista de producto / sesiones totales del periodo.",
  productViewToCartRate:
    "Sesiones con add_to_cart / sesiones con vista de producto.",
  cartToCheckoutRate:
    "Sesiones con checkout_started / sesiones con add_to_cart.",
  checkoutToPurchaseRate:
    "Sesiones con compra / sesiones con checkout_started.",
  sessionConversionRate:
    "Sesiones con compra / sesiones totales del periodo (conversion de sesion).",
  viewToCartRate:
    "Eventos add_to_cart de un producto / eventos product_view del mismo producto.",
  ordersPerHundredViews:
    "Pedidos pagados que incluyen el producto (coleccion de pedidos) por cada 100 vistas del producto (telemetria). Numerador y denominador vienen de fuentes distintas.",
  unitsPerHundredViews:
    "Unidades pagadas del producto por cada 100 vistas del producto.",
};

export interface BehaviorDailyPoint {
  date: string;
  weekday: string;
  visits: number;
  sessions: number;
  productViews: number;
  addToCart: number;
  checkoutStarted: number;
  purchases: number;
}

export interface TrafficSummary {
  visits: number;
  sessions: number;
  visitors: number;
  authenticatedSessions: number;
  productViews: number;
  productClicks: number;
  addToCartEvents: number;
  checkoutStarted: number;
  purchases: number;
  searches: number;
  visitsPerSession: number;
  productViewsPerSession: number;
  sessionConversionRate: number;
}

const countType = (
  events: AnalyticsBehaviorEvent[],
  type: BehaviorEventType,
): number => events.filter((event) => event.type === type).length;

const distinct = (
  events: AnalyticsBehaviorEvent[],
  pick: (event: AnalyticsBehaviorEvent) => string | null,
): Set<string> => {
  const values = new Set<string>();
  for (const event of events) {
    const value = pick(event);
    if (value) {
      values.add(value);
    }
  }
  return values;
};

/**
 * Compras distintas: la telemetria puede recibir el mismo evento dos veces
 * (recarga de la pantalla de confirmacion), por lo que se deduplica por orden.
 */
export const countDistinctPurchases = (
  events: AnalyticsBehaviorEvent[],
): { purchases: number; duplicatedPurchaseEvents: number } => {
  const purchaseEvents = events.filter((event) => event.type === "purchase");
  const withRef = new Set<string>();
  let withoutRef = 0;

  for (const event of purchaseEvents) {
    if (event.orderRef) {
      withRef.add(event.orderRef);
    } else {
      withoutRef += 1;
    }
  }

  const purchases = withRef.size + withoutRef;

  return {
    purchases,
    duplicatedPurchaseEvents: Math.max(0, purchaseEvents.length - purchases),
  };
};

export const summarizeTraffic = (
  events: AnalyticsBehaviorEvent[],
): TrafficSummary => {
  const sessions = distinct(events, (event) => event.sessionKey);
  const visitors = distinct(events, (event) => event.visitorKey);
  const authenticated = distinct(events, (event) =>
    event.authenticated ? event.sessionKey : null,
  );

  const visits = countType(events, "page_view");
  const productViews = countType(events, "product_view");
  const { purchases } = countDistinctPurchases(events);

  const sessionsWithPurchase = distinct(events, (event) =>
    event.type === "purchase" ? event.sessionKey : null,
  );

  return {
    visits,
    sessions: sessions.size,
    visitors: visitors.size,
    authenticatedSessions: authenticated.size,
    productViews,
    productClicks: countType(events, "product_click"),
    addToCartEvents: countType(events, "add_to_cart"),
    checkoutStarted: countType(events, "checkout_started"),
    purchases,
    searches: countType(events, "search"),
    visitsPerSession: sessions.size > 0 ? round2(visits / sessions.size) : 0,
    productViewsPerSession:
      sessions.size > 0 ? round2(productViews / sessions.size) : 0,
    sessionConversionRate:
      sessions.size > 0
        ? round2((sessionsWithPurchase.size / sessions.size) * 100)
        : 0,
  };
};

/** Serie diaria completa: los dias sin eventos quedan en cero, no ausentes. */
export const buildBehaviorDailySeries = (
  events: AnalyticsBehaviorEvent[],
  period: ResolvedPeriod,
): BehaviorDailyPoint[] => {
  const sessionsByDay = new Map<string, Set<string>>();
  const purchaseRefsByDay = new Map<string, Set<string>>();
  const buckets = new Map<string, BehaviorDailyPoint>();

  for (const dayKey of listDayKeys(period)) {
    buckets.set(dayKey, {
      date: dayKey,
      weekday: describeWeekday(dayKey),
      visits: 0,
      sessions: 0,
      productViews: 0,
      addToCart: 0,
      checkoutStarted: 0,
      purchases: 0,
    });
    sessionsByDay.set(dayKey, new Set());
    purchaseRefsByDay.set(dayKey, new Set());
  }

  for (const event of events) {
    const bucket = buckets.get(event.dayKey);
    if (!bucket) {
      continue;
    }

    if (event.sessionKey) {
      sessionsByDay.get(event.dayKey)?.add(event.sessionKey);
    }

    switch (event.type) {
      case "page_view":
        bucket.visits += 1;
        break;
      case "product_view":
        bucket.productViews += 1;
        break;
      case "add_to_cart":
        bucket.addToCart += 1;
        break;
      case "checkout_started":
        bucket.checkoutStarted += 1;
        break;
      case "purchase": {
        const refs = purchaseRefsByDay.get(event.dayKey);
        const ref = event.orderRef;
        if (!ref) {
          bucket.purchases += 1;
        } else if (refs && !refs.has(ref)) {
          refs.add(ref);
          bucket.purchases += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [dayKey, sessions] of sessionsByDay.entries()) {
    const bucket = buckets.get(dayKey);
    if (bucket) {
      bucket.sessions = sessions.size;
    }
  }

  return Array.from(buckets.values());
};

export interface HourlyPoint {
  hour: number;
  visits: number;
  productViews: number;
}

export const buildHourlyDistribution = (
  events: AnalyticsBehaviorEvent[],
): HourlyPoint[] => {
  const buckets: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    visits: 0,
    productViews: 0,
  }));

  for (const event of events) {
    const bucket = buckets[event.hour];
    if (!bucket) {
      continue;
    }

    if (event.type === "page_view") {
      bucket.visits += 1;
    } else if (event.type === "product_view") {
      bucket.productViews += 1;
    }
  }

  return buckets;
};

export interface FunnelStage {
  stage: string;
  label: string;
  sessions: number;
  /** Conversion respecto a la etapa anterior. */
  conversionFromPreviousRate: number | null;
  /** Conversion respecto a la primera etapa. */
  conversionFromStartRate: number | null;
  /** Sesiones perdidas frente a la etapa anterior. */
  droppedFromPrevious: number | null;
  dropRateFromPrevious: number | null;
  /**
   * false cuando el evento de la etapa no tiene telemetria registrada. Una
   * etapa sin telemetria no significa que los clientes se hayan caido ahi.
   */
  hasTelemetry: boolean;
}

const STAGE_LABELS: Array<{
  stage: string;
  label: string;
  /** Tipo de evento que sustenta la etapa. `null` = cualquier actividad. */
  eventType: BehaviorEventType | null;
  matches: (event: AnalyticsBehaviorEvent) => boolean;
}> = [
  {
    stage: "visit",
    label: "Sesiones con actividad",
    eventType: null,
    matches: () => true,
  },
  {
    stage: "product_view",
    label: "Sesiones que vieron producto",
    eventType: "product_view",
    matches: (event) => event.type === "product_view",
  },
  {
    stage: "add_to_cart",
    label: "Sesiones que agregaron al carrito",
    eventType: "add_to_cart",
    matches: (event) => event.type === "add_to_cart",
  },
  {
    stage: "checkout_started",
    label: "Sesiones que iniciaron checkout",
    eventType: "checkout_started",
    matches: (event) => event.type === "checkout_started",
  },
  {
    stage: "purchase",
    label: "Sesiones que compraron",
    eventType: "purchase",
    matches: (event) => event.type === "purchase",
  },
];

/**
 * Funnel a nivel sesion. Se cuenta una sesion en una etapa si registro el
 * evento correspondiente en el periodo, sin exigir orden temporal estricto
 * (una sesion puede empezar antes del corte del periodo).
 */
export const buildConversionFunnel = (
  events: AnalyticsBehaviorEvent[],
  options: { availableFrom?: Record<string, string | null> } = {},
): {
  stages: FunnelStage[];
  biggestDropStage: string | null;
  stagesWithoutTelemetry: string[];
} => {
  const stages: FunnelStage[] = [];
  let previous: number | null = null;
  let start: number | null = null;

  for (const definition of STAGE_LABELS) {
    const sessions = distinct(events, (event) =>
      definition.matches(event) ? event.sessionKey : null,
    ).size;

    if (start === null) {
      start = sessions;
    }

    // Si el tipo de evento nunca se registro, la etapa no tiene telemetria.
    // Cuando no se pudo consultar el primer dia disponible se cae al dato del
    // propio periodo para no afirmar una caida que no se puede sostener.
    const earliestDay = definition.eventType
      ? options.availableFrom?.[definition.eventType]
      : undefined;
    const hasTelemetry =
      definition.eventType === null ||
      (earliestDay === undefined ? sessions > 0 : earliestDay !== null);

    const comparable = hasTelemetry && previous !== null && previous > 0;

    stages.push({
      stage: definition.stage,
      label: definition.label,
      sessions,
      hasTelemetry,
      conversionFromPreviousRate: comparable
        ? round2((sessions / (previous as number)) * 100)
        : null,
      conversionFromStartRate:
        hasTelemetry && start > 0 ? round2((sessions / start) * 100) : null,
      droppedFromPrevious: comparable
        ? Math.max(0, (previous as number) - sessions)
        : null,
      dropRateFromPrevious: comparable
        ? round2((Math.max(0, (previous as number) - sessions) / (previous as number)) * 100)
        : null,
    });

    previous = sessions;
  }

  // Una etapa sin telemetria no puede ser "donde se pierde mas gente".
  const withDrop = stages.filter(
    (stage) => stage.dropRateFromPrevious !== null && stage.hasTelemetry,
  );
  const biggest = withDrop.reduce<FunnelStage | null>((worst, stage) => {
    if (!worst) {
      return stage;
    }
    return (stage.dropRateFromPrevious ?? 0) > (worst.dropRateFromPrevious ?? 0)
      ? stage
      : worst;
  }, null);

  return {
    stages,
    biggestDropStage: biggest ? biggest.stage : null,
    stagesWithoutTelemetry: stages
      .filter((stage) => !stage.hasTelemetry)
      .map((stage) => stage.stage),
  };
};

export interface ProductBehaviorAggregate {
  productId: string;
  views: number;
  uniqueViewers: number;
  clicks: number;
  addToCart: number;
  viewToCartRate: number;
}

export const aggregateProductBehavior = (
  events: AnalyticsBehaviorEvent[],
): Map<string, ProductBehaviorAggregate> => {
  const viewers = new Map<string, Set<string>>();
  const aggregates = new Map<string, ProductBehaviorAggregate>();

  const ensure = (productId: string): ProductBehaviorAggregate => {
    const existing = aggregates.get(productId);
    if (existing) {
      return existing;
    }

    const created: ProductBehaviorAggregate = {
      productId,
      views: 0,
      uniqueViewers: 0,
      clicks: 0,
      addToCart: 0,
      viewToCartRate: 0,
    };
    aggregates.set(productId, created);
    return created;
  };

  for (const event of events) {
    if (!event.productId) {
      continue;
    }

    const aggregate = ensure(event.productId);

    if (event.type === "product_view") {
      aggregate.views += 1;
      if (event.visitorKey) {
        const set = viewers.get(event.productId) || new Set<string>();
        set.add(event.visitorKey);
        viewers.set(event.productId, set);
      }
    } else if (event.type === "product_click") {
      aggregate.clicks += 1;
    } else if (event.type === "add_to_cart") {
      aggregate.addToCart += 1;
    }
  }

  for (const aggregate of aggregates.values()) {
    aggregate.uniqueViewers = viewers.get(aggregate.productId)?.size ?? 0;
    aggregate.viewToCartRate =
      aggregate.views > 0
        ? round2((aggregate.addToCart / aggregate.views) * 100)
        : 0;
  }

  return aggregates;
};

export interface TrafficSourceGroup {
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  productViews: number;
  purchases: number;
  sessionConversionRate: number;
}

const DIRECT_SOURCE = "directo";

/**
 * Origen de trafico por sesion (first touch): se toma el primer evento de la
 * sesion dentro del periodo que declare origen. Si ninguno lo declara la
 * sesion se clasifica como "directo".
 */
export const groupTrafficSources = (
  events: AnalyticsBehaviorEvent[],
): { groups: TrafficSourceGroup[]; sessionsWithoutAttribution: number } => {
  const bySession = new Map<
    string,
    {
      source: string;
      medium: string;
      campaign: string | null;
      attributed: boolean;
      productViews: number;
      purchaseRefs: Set<string>;
      purchasesWithoutRef: number;
    }
  >();

  const ordered = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  for (const event of ordered) {
    if (!event.sessionKey) {
      continue;
    }

    const entry =
      bySession.get(event.sessionKey) ||
      {
        source: DIRECT_SOURCE,
        medium: DIRECT_SOURCE,
        campaign: null,
        attributed: false,
        productViews: 0,
        purchaseRefs: new Set<string>(),
        purchasesWithoutRef: 0,
      };

    if (!entry.attributed && (event.source || event.referrerHost)) {
      entry.source = event.source || event.referrerHost || DIRECT_SOURCE;
      entry.medium = event.medium || (event.source ? "desconocido" : "referral");
      entry.campaign = event.campaign;
      entry.attributed = true;
    }

    if (event.type === "product_view") {
      entry.productViews += 1;
    }

    if (event.type === "purchase") {
      if (event.orderRef) {
        entry.purchaseRefs.add(event.orderRef);
      } else {
        entry.purchasesWithoutRef += 1;
      }
    }

    bySession.set(event.sessionKey, entry);
  }

  const grouped = new Map<string, TrafficSourceGroup>();
  let sessionsWithoutAttribution = 0;

  for (const entry of bySession.values()) {
    if (!entry.attributed) {
      sessionsWithoutAttribution += 1;
    }

    const key = `${entry.source}|${entry.medium}|${entry.campaign ?? ""}`;
    const group =
      grouped.get(key) ||
      {
        source: entry.source,
        medium: entry.medium,
        campaign: entry.campaign,
        sessions: 0,
        productViews: 0,
        purchases: 0,
        sessionConversionRate: 0,
      };

    group.sessions += 1;
    group.productViews += entry.productViews;
    group.purchases += entry.purchaseRefs.size + entry.purchasesWithoutRef;
    grouped.set(key, group);
  }

  const groups = Array.from(grouped.values()).map((group) => ({
    ...group,
    sessionConversionRate:
      group.sessions > 0 ? round2((group.purchases / group.sessions) * 100) : 0,
  }));

  groups.sort((a, b) => b.sessions - a.sessions);

  return { groups, sessionsWithoutAttribution };
};

/** Percentil por interpolacion lineal sobre una muestra ya ordenada. */
export const percentile = (sortedValues: number[], p: number): number => {
  if (sortedValues.length === 0) {
    return 0;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const clamped = Math.min(100, Math.max(0, p));
  const position = ((sortedValues.length - 1) * clamped) / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

export const median = (values: number[]): number =>
  percentile([...values].sort((a, b) => a - b), 50);

export const INTEREST_SEGMENTS = [
  "alto_interes_alta_conversion",
  "alto_interes_baja_conversion",
  "bajo_interes_alta_conversion",
  "bajo_interes_baja_conversion",
] as const;

export type InterestSegment = (typeof INTEREST_SEGMENTS)[number];

/**
 * Clasificacion relativa a la distribucion observada, no a umbrales fijos:
 * "alto interes" = vistas por encima de la mediana de productos con vistas.
 */
export const classifyInterest = (input: {
  views: number;
  conversion: number;
  viewsThreshold: number;
  conversionThreshold: number;
}): InterestSegment => {
  const highInterest = input.views >= input.viewsThreshold;
  const highConversion = input.conversion >= input.conversionThreshold;

  if (highInterest && highConversion) {
    return "alto_interes_alta_conversion";
  }
  if (highInterest) {
    return "alto_interes_baja_conversion";
  }
  if (highConversion) {
    return "bajo_interes_alta_conversion";
  }
  return "bajo_interes_baja_conversion";
};

export const buildBehaviorDataQuality = (
  page: AnalyticsBehaviorPage,
  period: ResolvedPeriod,
  extras: {
    availableFrom?: Record<string, string | null>;
    unknownProductIds?: number;
  } = {},
): Record<string, unknown> => {
  const notes: string[] = [];
  const { duplicatedPurchaseEvents } = countDistinctPurchases(page.events);

  if (page.truncated) {
    notes.push(
      "El periodo supera el limite de eventos que el agente puede leer; las metricas de trafico pueden estar incompletas.",
    );
  }

  if (page.events.length === 0) {
    notes.push(
      `No hay eventos de comportamiento registrados en ${period.label}.`,
    );
  }

  if (page.invalidEvents > 0) {
    notes.push(
      `${page.invalidEvents} eventos se descartaron por no tener fecha valida o tipo reconocido.`,
    );
  }

  if (duplicatedPurchaseEvents > 0) {
    notes.push(
      `${duplicatedPurchaseEvents} eventos de compra repetidos se deduplicaron por id de orden.`,
    );
  }

  if (extras.unknownProductIds && extras.unknownProductIds > 0) {
    notes.push(
      `${extras.unknownProductIds} productos con vistas ya no existen en el catalogo y se excluyeron del ranking.`,
    );
  }

  const availableFrom = extras.availableFrom || {};
  for (const [type, day] of Object.entries(availableFrom)) {
    if (!day) {
      notes.push(`No existe historial del evento ${type}.`);
      continue;
    }

    if (day > period.fromDayKey) {
      notes.push(
        `El evento ${type} solo tiene datos desde ${day}; el periodo consultado empieza antes y no puede compararse completo.`,
      );
    }
  }

  return {
    eventsScanned: page.events.length,
    truncated: page.truncated,
    invalidEvents: page.invalidEvents,
    duplicatedPurchaseEvents,
    typeFilterAppliedInMemory: page.filteredInMemory,
    dataAvailableFrom: availableFrom,
    notes,
  };
};

export const __behaviorMetricsTestables = {
  round2,
  distinct,
};
