import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { admin } from "./config/firebase.admin";

const USERS_COLLECTION_PATH = "usuariosApp/{userId}";

const LEVELS = {
  BRONCE: "Bronce",
  PLATA: "Plata",
  ORO: "Oro",
  PLATINO: "Platino",
  DIAMANTE: "Diamante",
  ESMERALDA: "Esmeralda",
} as const;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizePoints = (value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return null;
  }

  return Math.max(0, Math.trunc(parsed));
};

const getPointsFromUserData = (data: FirebaseFirestore.DocumentData | undefined): number => {
  if (!data) {
    return 0;
  }

  const fromPuntosActuales = normalizePoints(data.puntosActuales);
  if (fromPuntosActuales !== null) {
    return fromPuntosActuales;
  }

  const fromPuntos = normalizePoints(data.puntos);
  if (fromPuntos !== null) {
    return fromPuntos;
  }

  return 0;
};

const getLevelByPoints = (points: number): string => {
  if (points >= 1050) {
    return LEVELS.ESMERALDA;
  }
  if (points >= 750) {
    return LEVELS.DIAMANTE;
  }
  if (points >= 450) {
    return LEVELS.PLATINO;
  }
  if (points >= 300) {
    return LEVELS.ORO;
  }
  if (points >= 150) {
    return LEVELS.PLATA;
  }
  return LEVELS.BRONCE;
};

export const syncUserLevelOnPointsChange = onDocumentWritten(
  USERS_COLLECTION_PATH,
  async (event) => {
    const afterSnap = event.data?.after;
    if (!afterSnap?.exists) {
      return;
    }

    const ref = afterSnap.ref;

    // El snapshot del evento puede llegar con minutos de retraso y traer un
    // saldo ya superado. Reescribir `puntosActuales` desde él pisa puntos
    // legítimos: es el patrón "leer, calcular, escribir absoluto" que provocó
    // el incidente POS. Se relee dentro de una transacción y este trigger sólo
    // mantiene `nivel`; el saldo lo mueve exclusivamente el motor de loyalty.
    const result = await ref.firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) {
        return null;
      }

      const data = fresh.data();
      const points = getPointsFromUserData(data);
      const expectedLevel = getLevelByPoints(points);
      const currentLevel =
        typeof data?.nivel === "string" ? data.nivel.trim() : "";
      const needsLevelSync = currentLevel !== expectedLevel;

      // Único caso en que este trigger toca el saldo: materializar el campo
      // legacy `puntos` cuando `puntosActuales` no existe todavía.
      const needsPointsBackfill = normalizePoints(data?.puntosActuales) === null;

      if (!needsLevelSync && !needsPointsBackfill) {
        return null;
      }

      const update: Record<string, unknown> = {
        nivel: expectedLevel,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (needsPointsBackfill) {
        update.puntosActuales = points;
      }

      tx.set(ref, update, { merge: true });
      return { points, expectedLevel, needsLevelSync, needsPointsBackfill };
    });

    if (!result) {
      return;
    }

    logger.info("Nivel sincronizado por cambio de puntos", {
      userId: event.params.userId,
      points: result.points,
      level: result.expectedLevel,
      needsLevelSync: result.needsLevelSync,
      needsPointsBackfill: result.needsPointsBackfill,
    });
  },
);
