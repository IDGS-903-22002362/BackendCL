/**
 * Acceso READ-ONLY a la telemetria de comportamiento del storefront para el
 * Asistente Administrativo.
 *
 * No se crea una coleccion nueva: se reutiliza `recomendacionEventos`, que ya
 * es el almacen first-party de eventos del proyecto (identidad de visitante,
 * retencion configurable, TTL, rate limiting e indices existentes).
 *
 * Este repositorio nunca escribe. Los identificadores de visitante y sesion se
 * proyectan solo para poder contar sesiones/visitantes distintos: jamas se
 * incluyen en la evidencia que se envia al modelo.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../../config/firebase";
import { RecomendacionEventoTipo } from "../../../models/recomendaciones.model";
import logger from "../../../utils/logger";
import { recomendacionCollections } from "../../recomendaciones/collections";
import {
  ResolvedPeriod,
  toAnalyticsDayKey,
  toAnalyticsHour,
} from "./period.util";

/** Tope defensivo: evita cargar periodos gigantes de eventos en memoria. */
export const MAX_BEHAVIOR_EVENTS_SCANNED = 20000;

/**
 * Nombres neutrales usados dentro del agente. Se mapean 1:1 con los tipos
 * reales de `recomendacionEventos` para no duplicar el catalogo de eventos.
 */
export const BEHAVIOR_EVENT_TYPES = [
  "page_view",
  "product_view",
  "product_click",
  "add_to_cart",
  "checkout_started",
  "purchase",
  "search",
] as const;

export type BehaviorEventType = (typeof BEHAVIOR_EVENT_TYPES)[number];

const TYPE_BY_STORED_VALUE: Record<string, BehaviorEventType> = {
  [RecomendacionEventoTipo.VISTA_PAGINA]: "page_view",
  [RecomendacionEventoTipo.VISTA_PRODUCTO]: "product_view",
  [RecomendacionEventoTipo.CLIC_PRODUCTO]: "product_click",
  [RecomendacionEventoTipo.AGREGAR_CARRITO]: "add_to_cart",
  [RecomendacionEventoTipo.INICIO_CHECKOUT]: "checkout_started",
  [RecomendacionEventoTipo.COMPRA]: "purchase",
  [RecomendacionEventoTipo.BUSQUEDA]: "search",
};

const STORED_VALUE_BY_TYPE = Object.entries(TYPE_BY_STORED_VALUE).reduce(
  (acc, [stored, type]) => {
    acc[type] = stored;
    return acc;
  },
  {} as Record<BehaviorEventType, string>,
);

export interface AnalyticsBehaviorEvent {
  id: string;
  type: BehaviorEventType;
  createdAt: Date;
  dayKey: string;
  /** Hora local del negocio (0-23). */
  hour: number;
  productId: string | null;
  /** Pseudonimo. Solo para contar sesiones distintas; nunca va al modelo. */
  sessionKey: string | null;
  /** Pseudonimo. Solo para contar visitantes distintos; nunca va al modelo. */
  visitorKey: string | null;
  /** true cuando el evento proviene de una sesion autenticada. */
  authenticated: boolean;
  surface: string | null;
  /** Ruta visitada (solo para page_view). */
  path: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrerHost: string | null;
  /** Referencia de orden para deduplicar compras repetidas. */
  orderRef: string | null;
  searchTerm: string | null;
}

export interface AnalyticsBehaviorPage {
  events: AnalyticsBehaviorEvent[];
  /** true cuando se alcanzo MAX_BEHAVIOR_EVENTS_SCANNED. */
  truncated: boolean;
  /** true cuando el filtro por tipo no pudo aplicarse en Firestore. */
  filteredInMemory: boolean;
  /** Eventos descartados por datos invalidos (data quality). */
  invalidEvents: number;
}

const behaviorLogger = logger.child({ component: "analytics-behavior-repo" });

const toDate = (value: unknown): Date | null => {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime())
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  return null;
};

const readString = (value: unknown, maxLength = 120): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
};

const normalizeChannel = (value: unknown): string | null => {
  const parsed = readString(value, 60);
  return parsed ? parsed.toLowerCase() : null;
};

const mapEvent = (
  id: string,
  data: Record<string, unknown>,
): AnalyticsBehaviorEvent | null => {
  const type = TYPE_BY_STORED_VALUE[String(data.tipo)];
  if (!type) {
    return null;
  }

  const createdAt = toDate(data.createdAt);
  if (!createdAt) {
    return null;
  }

  const metadata = (
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata
      : {}
  ) as Record<string, unknown>;

  const usuarioId = readString(data.usuarioId, 128);
  const sessionId = readString(data.sessionId, 128);
  const visitanteId = readString(data.visitanteId, 160);

  return {
    id,
    type,
    createdAt,
    dayKey: toAnalyticsDayKey(createdAt),
    hour: toAnalyticsHour(createdAt),
    productId: readString(data.productoId, 128),
    sessionKey: sessionId || visitanteId || usuarioId,
    visitorKey: visitanteId || (usuarioId ? `user:${usuarioId}` : sessionId),
    authenticated: Boolean(usuarioId),
    surface: normalizeChannel(data.superficie),
    path: readString(metadata.path, 160),
    source: normalizeChannel(metadata.source ?? metadata.utm_source),
    medium: normalizeChannel(metadata.medium ?? metadata.utm_medium),
    campaign: normalizeChannel(metadata.campaign ?? metadata.utm_campaign),
    referrerHost: normalizeChannel(metadata.referrerHost ?? metadata.referrer),
    orderRef: readString(metadata.ordenId ?? metadata.orderId, 128),
    searchTerm: normalizeChannel(metadata.term ?? metadata.query),
  };
};

const isMissingIndexError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === 9 ||
    code === "failed-precondition" ||
    /requires an index|FAILED_PRECONDITION/i.test(message)
  );
};

class BehaviorRepository {
  private baseQuery(period: ResolvedPeriod) {
    return firestoreTienda
      .collection(recomendacionCollections.eventos)
      .where("createdAt", ">=", Timestamp.fromDate(period.start))
      .where("createdAt", "<", Timestamp.fromDate(period.endExclusive))
      .orderBy("createdAt", "asc")
      .limit(MAX_BEHAVIOR_EVENTS_SCANNED + 1);
  }

  /**
   * Eventos de comportamiento del periodo. Filtra por tipo en Firestore
   * cuando el indice compuesto (tipo, createdAt) esta disponible y cae a un
   * filtrado en memoria si todavia no se desplego.
   */
  async listEventsInPeriod(
    period: ResolvedPeriod,
    types: BehaviorEventType[] = [...BEHAVIOR_EVENT_TYPES],
  ): Promise<AnalyticsBehaviorPage> {
    const requested = types.length > 0 ? types : [...BEHAVIOR_EVENT_TYPES];
    const storedTypes = requested.map((type) => STORED_VALUE_BY_TYPE[type]);
    let filteredInMemory = false;

    let snapshot;
    try {
      snapshot = await this.baseQuery(period)
        .where("tipo", "in", storedTypes)
        .get();
    } catch (error) {
      if (!isMissingIndexError(error)) {
        throw error;
      }

      behaviorLogger.warn("behavior_events_index_fallback", {
        errorMessage: error instanceof Error ? error.message : "sin detalle",
        types: requested,
      });
      filteredInMemory = true;
      snapshot = await this.baseQuery(period).get();
    }

    const docs = snapshot.docs.slice(0, MAX_BEHAVIOR_EVENTS_SCANNED);
    const allowed = new Set(requested);
    const events: AnalyticsBehaviorEvent[] = [];
    let invalidEvents = 0;

    for (const doc of docs) {
      const data = doc.data() as Record<string, unknown>;
      const mapped = mapEvent(doc.id, data);

      if (!mapped) {
        // Solo cuenta como invalido si era un tipo que nos interesa.
        if (!filteredInMemory) {
          invalidEvents += 1;
        }
        continue;
      }

      if (!allowed.has(mapped.type)) {
        continue;
      }

      events.push(mapped);
    }

    return {
      events,
      truncated: snapshot.size > MAX_BEHAVIOR_EVENTS_SCANNED,
      filteredInMemory,
      invalidEvents,
    };
  }

  /**
   * Primer dia con datos por tipo de evento. Permite decir con honestidad
   * desde cuando existe cada metrica en lugar de inventar historia.
   *
   * `null` significa que el evento nunca se registro. Un tipo que no aparece en
   * el resultado significa que no se pudo determinar (consulta fallida): quien
   * lo consuma no debe concluir ausencia de datos a partir de eso.
   */
  async getEarliestEventDays(
    types: BehaviorEventType[] = [...BEHAVIOR_EVENT_TYPES],
  ): Promise<Record<string, string | null>> {
    const entries = await Promise.all(
      types.map(async (type) => {
        try {
          const snapshot = await firestoreTienda
            .collection(recomendacionCollections.eventos)
            .where("tipo", "==", STORED_VALUE_BY_TYPE[type])
            .orderBy("createdAt", "asc")
            .limit(1)
            .get();

          const first = snapshot.docs[0];
          if (!first) {
            return [type, null] as const;
          }

          const createdAt = toDate(
            (first.data() as Record<string, unknown>).createdAt,
          );
          return [type, createdAt ? toAnalyticsDayKey(createdAt) : null] as const;
        } catch (error) {
          behaviorLogger.warn("behavior_earliest_day_failed", {
            type,
            errorMessage: error instanceof Error ? error.message : "sin detalle",
          });
          return null;
        }
      }),
    );

    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [BehaviorEventType, string | null] =>
          entry !== null,
      ),
    );
  }
}

export const behaviorRepository = new BehaviorRepository();
export default behaviorRepository;

export const BEHAVIOR_COLLECTION = recomendacionCollections.eventos;

export const __behaviorTestables = {
  mapEvent,
  isMissingIndexError,
  TYPE_BY_STORED_VALUE,
  STORED_VALUE_BY_TYPE,
};
