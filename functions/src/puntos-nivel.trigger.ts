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

    const beforeData = event.data?.before?.data();
    const afterData = afterSnap.data();

    const pointsBefore = getPointsFromUserData(beforeData);
    const pointsAfter = getPointsFromUserData(afterData);
    const pointsChanged = pointsBefore !== pointsAfter;

    const expectedLevel = getLevelByPoints(pointsAfter);
    const currentLevel = typeof afterData?.nivel === "string" ? afterData.nivel.trim() : "";
    const needsLevelSync = currentLevel !== expectedLevel;

    const currentStoredPoints = normalizePoints(afterData?.puntosActuales);
    const needsPointsSync = currentStoredPoints !== pointsAfter;

    if (!pointsChanged && !needsLevelSync && !needsPointsSync) {
      return;
    }

    await afterSnap.ref.set(
      {
        puntosActuales: pointsAfter,
        nivel: expectedLevel,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info("Nivel sincronizado por cambio de puntos", {
      userId: event.params.userId,
      pointsBefore,
      pointsAfter,
      level: expectedLevel,
      pointsChanged,
      needsLevelSync,
      needsPointsSync,
    });
  },
);
