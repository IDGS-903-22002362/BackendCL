import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { TipoMovimientoPuntos } from "../../../models/usuario.model";
import {
  AnalyticsPeriodError,
  resolvePeriod,
} from "../../../services/ai/analytics/period.util";
import LoyaltyProblemError from "../errors/loyalty-problem.error";

const USUARIOS_COLLECTION = "usuariosApp";
const MOVIMIENTOS_GROUP = "movimientos_puntos";
const MAX_DAY_SCAN = 40_000;
const SCAN_PAGE_SIZE = 1_000;
const SCAN_RETRY_ATTEMPTS = 3;
const SCAN_RETRY_BASE_MS = 200;
const DEFAULT_MAX_SCAN_MS = 150_000;
const GET_ALL_CHUNK = 100;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MOVEMENT_PATH_PATTERN =
  /^(usuariosApp\/[^/]+\/)?movimientos_puntos\/[^/]+$/;

const EARN_TYPES = new Set<string>([
  TipoMovimientoPuntos.ACUMULACION,
  TipoMovimientoPuntos.BONIFICACION,
  TipoMovimientoPuntos.DEVOLUCION,
]);

export type PointsReportMember = {
  usuarioId: string;
  nombre: string | null;
  email: string | null;
};

export type PointsRedemptionRow = PointsReportMember & {
  movimientoId: string;
  puntos: number;
  descripcion: string | null;
  origen: string | null;
  referencia: string | null;
  saldoNuevo: number | null;
  createdAt: string;
};

export type PointsBalanceRow = PointsReportMember & {
  puntosActuales: number;
  nivel: string | null;
};

export type PointsEarnerRow = PointsReportMember & {
  puntosObtenidos: number;
  movimientos: number;
};

type MovementRecord = {
  id: string;
  path: string;
  usuarioId: string;
  tipo: string;
  puntos: number;
  descripcion: string | null;
  origen: string | null;
  referencia: string | null;
  saldoNuevo: number | null;
  createdAt: Date;
};

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function toSafeInt(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toMovementDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as Timestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function isEarnMovement(tipo: string, puntos: number): boolean {
  if (EARN_TYPES.has(tipo) && puntos > 0) {
    return true;
  }
  return tipo === TipoMovimientoPuntos.AJUSTE && puntos > 0;
}

export function isRetryableFirestoreError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code).toLowerCase()
      : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /unavailable|deadline|resource-exhausted|aborted|internal|econnreset|etimedout/.test(
      code,
    ) ||
    /unavailable|deadline|resource-exhausted|aborted|econnreset|etimedout/.test(
      message,
    )
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function addEarnMovement(
  totals: Map<string, { puntosObtenidos: number; movimientos: number }>,
  movement: Pick<MovementRecord, "usuarioId" | "tipo" | "puntos">,
): boolean {
  if (!movement.usuarioId || !isEarnMovement(movement.tipo, movement.puntos)) {
    return false;
  }
  const current = totals.get(movement.usuarioId) ?? {
    puntosObtenidos: 0,
    movimientos: 0,
  };
  current.puntosObtenidos += movement.puntos;
  current.movimientos += 1;
  totals.set(movement.usuarioId, current);
  return true;
}

export function aggregateEarners(
  movements: Array<Pick<MovementRecord, "usuarioId" | "tipo" | "puntos">>,
): Map<string, { puntosObtenidos: number; movimientos: number }> {
  const totals = new Map<
    string,
    { puntosObtenidos: number; movimientos: number }
  >();

  for (const movement of movements) {
    addEarnMovement(totals, movement);
  }

  return totals;
}

function assertDayKey(day: string): string {
  if (!DAY_KEY_PATTERN.test(day)) {
    throw new LoyaltyProblemError(
      "INVALID_AMOUNT",
      "La fecha debe tener formato YYYY-MM-DD.",
    );
  }
  try {
    resolvePeriod({ period: "custom", from: day, to: day });
  } catch (error) {
    if (error instanceof AnalyticsPeriodError) {
      throw new LoyaltyProblemError("INVALID_AMOUNT", error.message);
    }
    throw error;
  }
  return day;
}

function resolveDayRange(day: string): { start: Date; endExclusive: Date } {
  const period = resolvePeriod({
    period: "custom",
    from: assertDayKey(day),
    to: day,
  });
  return { start: period.start, endExclusive: period.endExclusive };
}

export type PointsReportsScanOptions = {
  maxDayScan?: number;
  scanPageSize?: number;
  maxScanMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class PointsReportsService {
  private readonly maxDayScan: number;
  private readonly scanPageSize: number;
  private readonly maxScanMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly firestore: FirebaseFirestore.Firestore = firestoreApp,
    options: PointsReportsScanOptions = {},
  ) {
    this.maxDayScan = Math.max(1, options.maxDayScan ?? MAX_DAY_SCAN);
    this.scanPageSize = Math.max(1, options.scanPageSize ?? SCAN_PAGE_SIZE);
    this.maxScanMs = Math.max(1, options.maxScanMs ?? DEFAULT_MAX_SCAN_MS);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
  }

  private isSafeMovementPath(path: string): boolean {
    return MOVEMENT_PATH_PATTERN.test(path.trim());
  }

  private mapMovementDoc(
    doc: FirebaseFirestore.QueryDocumentSnapshot,
  ): MovementRecord | null {
    try {
      const data = doc.data() ?? {};
      const createdAt = toMovementDate(data.createdAt);
      const usuarioId = normalizedText(data.usuarioId) || doc.ref.parent.parent?.id;
      if (!createdAt || !usuarioId) {
        return null;
      }

      return {
        id: doc.id,
        path: doc.ref.path,
        usuarioId,
        tipo: normalizedText(data.tipo),
        puntos: toSafeInt(data.puntos),
        descripcion: normalizedText(data.descripcion) || null,
        origen: normalizedText(data.origen) || null,
        referencia: normalizedText(data.referencia) || null,
        saldoNuevo:
          data.saldoNuevo === undefined || data.saldoNuevo === null
            ? null
            : toSafeInt(data.saldoNuevo),
        createdAt,
      };
    } catch {
      return null;
    }
  }

  private async enrichMembers(
    usuarioIds: string[],
  ): Promise<Map<string, PointsReportMember>> {
    const uniqueIds = Array.from(new Set(usuarioIds.filter(Boolean)));
    const profiles = new Map<string, PointsReportMember>();

    for (let offset = 0; offset < uniqueIds.length; offset += GET_ALL_CHUNK) {
      const chunk = uniqueIds.slice(offset, offset + GET_ALL_CHUNK);
      const refs = chunk.map((id) =>
        this.firestore.collection(USUARIOS_COLLECTION).doc(id),
      );
      try {
        const snapshots = await this.firestore.getAll(...refs);
        snapshots.forEach((snapshot, index) => {
          const usuarioId = chunk[index];
          if (!usuarioId) return;
          const data = snapshot.exists ? snapshot.data() : undefined;
          profiles.set(usuarioId, {
            usuarioId,
            nombre: snapshot.exists
              ? normalizedText(data?.nombre).slice(0, 120) || null
              : null,
            email: snapshot.exists
              ? normalizedText(data?.email).slice(0, 180) || null
              : null,
          });
        });
      } catch {
        chunk.forEach((usuarioId) => {
          if (!profiles.has(usuarioId)) {
            profiles.set(usuarioId, { usuarioId, nombre: null, email: null });
          }
        });
      }
    }

    return profiles;
  }

  private memberFallback(
    usuarioId: string,
    profile?: PointsReportMember,
  ): PointsReportMember {
    return {
      usuarioId,
      nombre: profile?.nombre ?? null,
      email: profile?.email ?? null,
    };
  }

  async listRedemptions(options: {
    limit: number;
    cursor?: string;
    from?: string;
    to?: string;
  }): Promise<{
    items: PointsRedemptionRow[];
    nextCursor: string | null;
    hasMore: boolean;
    summary: {
      pageCount: number;
      pagePoints: number;
    };
  }> {
    let query: FirebaseFirestore.Query = this.firestore
      .collectionGroup(MOVIMIENTOS_GROUP)
      .where("tipo", "==", TipoMovimientoPuntos.CANJE);

    if (options.from || options.to) {
      const fromDay = options.from ?? options.to ?? "";
      const toDay = options.to ?? options.from ?? "";
      if (fromDay > toDay) {
        throw new LoyaltyProblemError(
          "INVALID_AMOUNT",
          'El campo "from" no puede ser posterior a "to".',
        );
      }
      const range = resolvePeriod({
        period: "custom",
        from: assertDayKey(fromDay),
        to: assertDayKey(toDay),
      });
      query = query
        .where("createdAt", ">=", Timestamp.fromDate(range.start))
        .where("createdAt", "<", Timestamp.fromDate(range.endExclusive));
    }

    query = query.orderBy("createdAt", "desc").limit(options.limit + 1);

    if (options.cursor && this.isSafeMovementPath(options.cursor)) {
      const cursorSnap = await this.firestore.doc(options.cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    const snap = await query.get();
    const mapped = snap.docs
      .map((doc) => this.mapMovementDoc(doc))
      .filter((item): item is MovementRecord => item !== null);
    const hasMore = mapped.length > options.limit;
    const page = hasMore ? mapped.slice(0, options.limit) : mapped;
    const profiles = await this.enrichMembers(page.map((item) => item.usuarioId));

    const items = page.map((item) => ({
      movimientoId: item.id,
      ...this.memberFallback(item.usuarioId, profiles.get(item.usuarioId)),
      puntos: Math.abs(item.puntos),
      descripcion: item.descripcion,
      origen: item.origen,
      referencia: item.referencia,
      saldoNuevo: item.saldoNuevo,
      createdAt: item.createdAt.toISOString(),
    }));

    return {
      items,
      nextCursor: hasMore ? page.at(-1)?.path ?? null : null,
      hasMore,
      summary: {
        pageCount: items.length,
        pagePoints: items.reduce((sum, item) => sum + item.puntos, 0),
      },
    };
  }

  async listTopBalances(limit: number): Promise<{ items: PointsBalanceRow[] }> {
    const snap = await this.firestore
      .collection(USUARIOS_COLLECTION)
      .where("puntosActuales", ">", 0)
      .orderBy("puntosActuales", "desc")
      .limit(limit)
      .get();

    const items: PointsBalanceRow[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        usuarioId: doc.id,
        nombre: normalizedText(data.nombre).slice(0, 120) || null,
        email: normalizedText(data.email).slice(0, 180) || null,
        puntosActuales: Math.max(0, toSafeInt(data.puntosActuales)),
        nivel: normalizedText(data.nivel).slice(0, 40) || null,
      };
    });

    return { items };
  }

  private async getQuerySnapshotWithRetry(
    query: FirebaseFirestore.Query,
  ): Promise<FirebaseFirestore.QuerySnapshot> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SCAN_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await query.get();
      } catch (error) {
        lastError = error;
        if (attempt >= SCAN_RETRY_ATTEMPTS || !isRetryableFirestoreError(error)) {
          break;
        }
        await this.sleep(SCAN_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  private async scanDayEarnMovements(day: string): Promise<{
    totals: Map<string, { puntosObtenidos: number; movimientos: number }>;
    movimientosRevisados: number;
    truncated: boolean;
  }> {
    const { start, endExclusive } = resolveDayRange(day);
    const totals = new Map<string, { puntosObtenidos: number; movimientos: number }>();
    const seenPaths = new Set<string>();
    const startedAt = this.now();
    const maxPages = Math.ceil(this.maxDayScan / this.scanPageSize) + 2;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    let scanned = 0;
    let movimientosRevisados = 0;
    let lastPageWasFull = false;
    let truncated = false;
    let pages = 0;

    while (scanned < this.maxDayScan && pages < maxPages) {
      if (scanned > 0 && this.now() - startedAt >= this.maxScanMs) {
        truncated = true;
        break;
      }

      const pageSize = Math.min(this.scanPageSize, this.maxDayScan - scanned);
      let query: FirebaseFirestore.Query = this.firestore
        .collectionGroup(MOVIMIENTOS_GROUP)
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<", Timestamp.fromDate(endExclusive))
        .orderBy("createdAt", "desc")
        .limit(pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      let snap: FirebaseFirestore.QuerySnapshot;
      try {
        snap = await this.getQuerySnapshotWithRetry(query);
      } catch (error) {
        if (scanned > 0) {
          truncated = true;
          break;
        }
        throw error;
      }

      pages += 1;
      if (snap.empty) {
        lastPageWasFull = false;
        break;
      }

      const unseenDocs = snap.docs.filter((doc) => !seenPaths.has(doc.ref.path));
      if (unseenDocs.length === 0) {
        lastPageWasFull = false;
        break;
      }

      scanned += unseenDocs.length;
      lastDoc = snap.docs[snap.docs.length - 1];
      lastPageWasFull = snap.docs.length === pageSize;

      for (const doc of unseenDocs) {
        seenPaths.add(doc.ref.path);
        const mapped = this.mapMovementDoc(doc);
        if (!mapped) continue;
        if (addEarnMovement(totals, mapped)) {
          movimientosRevisados += 1;
        }
      }

      if (!lastPageWasFull) {
        break;
      }
    }

    return {
      totals,
      movimientosRevisados,
      truncated: truncated || (scanned >= this.maxDayScan && lastPageWasFull),
    };
  }

  async listTopEarners(options: {
    day: string;
    limit: number;
  }): Promise<{
    items: PointsEarnerRow[];
    summary: {
      day: string;
      totalPuntos: number;
      usuarios: number;
      movimientosRevisados: number;
      truncated: boolean;
    };
  }> {
    const { totals, movimientosRevisados, truncated } =
      await this.scanDayEarnMovements(options.day);
    const ranked = Array.from(totals.entries())
      .sort((a, b) => {
        const pointsDelta = b[1].puntosObtenidos - a[1].puntosObtenidos;
        if (pointsDelta !== 0) return pointsDelta;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, options.limit);

    const profiles = await this.enrichMembers(ranked.map(([usuarioId]) => usuarioId));
    const items = ranked.map(([usuarioId, stats]) => ({
      ...this.memberFallback(usuarioId, profiles.get(usuarioId)),
      puntosObtenidos: stats.puntosObtenidos,
      movimientos: stats.movimientos,
    }));

    return {
      items,
      summary: {
        day: options.day,
        totalPuntos: Array.from(totals.values()).reduce(
          (sum, item) => sum + item.puntosObtenidos,
          0,
        ),
        usuarios: totals.size,
        movimientosRevisados,
        truncated,
      },
    };
  }
}

export const pointsReportsService = new PointsReportsService();
export default pointsReportsService;
