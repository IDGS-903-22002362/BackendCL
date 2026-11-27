import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../config/app.firebase";
import { PRODUCTION_FIREBASE_PROJECT_IDS } from "../config/local-firestore-guard";

/**
 * Cartas coleccionables de prueba.
 *
 * Dejan ver una carta de la colección en una cuenta que no ganó su premio,
 * solo para revisar el diseño en la app. No son premios: no crean jugadas
 * ni ganadores, no tocan existencias, probabilidades ni puntos, y no
 * aparecen en /minijuegos/me/beneficios ni en los ganadores del panel.
 *
 * Solo existen fuera de producción. El endpoint responde únicamente con
 * TEST_PRIZE_CARDS=true y contra el emulador de Firestore o un proyecto que
 * no sea productivo, y las cartas solo se asignan con el script
 * `npm run cards:test-grant` (no hay endpoint para asignarlas).
 */
export const CARTAS_PRUEBA_COLLECTION = "cartasPrueba";

/** Diseños que admite una carta de prueba, con el premio que representan. */
export const DISENOS_CARTA_PRUEBA = {
  globo: "VUELO EN GLOBO",
} as const;

export type DisenoCartaPrueba = keyof typeof DISENOS_CARTA_PRUEBA;

export type CartaPrueba = {
  id: string;
  diseno: DisenoCartaPrueba;
  premioNombre: string;
  asignadaEl: string;
};

export class CartaPruebaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartaPruebaError";
  }
}

export function isDisenoCartaPrueba(value: unknown): value is DisenoCartaPrueba {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DISENOS_CARTA_PRUEBA, value)
  );
}

/**
 * Firestore de pruebas: el emulador, o un proyecto que no sea productivo.
 * Nunca app-oficial-leon ni e-comerce-leon.
 */
export function isTestCardsFirestore(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.FIRESTORE_EMULATOR_HOST ?? "").trim()) return true;
  const projectId = (env.APP_OFICIAL_PROJECT_ID || "app-oficial-leon").trim();
  return projectId.length > 0 && !PRODUCTION_FIREBASE_PROJECT_IDS.has(projectId);
}

/** Las cartas de prueba se sirven solo si se piden y el entorno es de pruebas. */
export function testPrizeCardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEST_PRIZE_CARDS === "true" && isTestCardsFirestore(env);
}

/** Un documento por cuenta y diseño: asignar dos veces no duplica la carta. */
export function cartaPruebaId(uid: string, diseno: DisenoCartaPrueba): string {
  return `${uid}__${diseno}`;
}

function readDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toCartaPrueba(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): CartaPrueba | null {
  if (!data || !isDisenoCartaPrueba(data.diseno)) return null;
  const asignadaEl = readDate(data.asignadaEl) ?? new Date(0);
  const premioNombre =
    typeof data.premioNombre === "string" && data.premioNombre.trim()
      ? data.premioNombre.trim()
      : DISENOS_CARTA_PRUEBA[data.diseno];
  return {
    id,
    diseno: data.diseno,
    premioNombre,
    asignadaEl: asignadaEl.toISOString(),
  };
}

function requireUid(uid: string): string {
  const value = typeof uid === "string" ? uid.trim() : "";
  if (!value) throw new CartaPruebaError("Falta el uid de la cuenta.");
  return value;
}

function requireDiseno(diseno: string): DisenoCartaPrueba {
  if (!isDisenoCartaPrueba(diseno)) {
    throw new CartaPruebaError(
      `Diseño desconocido "${diseno}". Usa uno de: ${Object.keys(DISENOS_CARTA_PRUEBA).join(", ")}.`,
    );
  }
  return diseno;
}

/** Cartas de prueba de una cuenta, la más reciente primero. */
export async function listCartasPrueba(uid: string): Promise<CartaPrueba[]> {
  const owner = requireUid(uid);
  const snap = await firestoreApp
    .collection(CARTAS_PRUEBA_COLLECTION)
    .where("uid", "==", owner)
    .get();
  return snap.docs
    .filter((doc) => doc.data()?.uid === owner)
    .map((doc) => toCartaPrueba(doc.id, doc.data()))
    .filter((carta): carta is CartaPrueba => carta !== null)
    .sort((a, b) => b.asignadaEl.localeCompare(a.asignadaEl));
}

/**
 * Asigna una carta de prueba a una cuenta. Si ya la tenía, la deja como
 * estaba y devuelve `created: false`.
 */
export async function grantCartaPrueba(input: {
  uid: string;
  diseno: string;
  motivo?: string;
  now?: Date;
}): Promise<{ carta: CartaPrueba; created: boolean }> {
  const uid = requireUid(input.uid);
  const diseno = requireDiseno(input.diseno);
  const ref = firestoreApp
    .collection(CARTAS_PRUEBA_COLLECTION)
    .doc(cartaPruebaId(uid, diseno));

  return firestoreApp.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = toCartaPrueba(ref.id, snap.data());
      if (!existing) {
        throw new CartaPruebaError(
          `El documento ${CARTAS_PRUEBA_COLLECTION}/${ref.id} no es una carta de prueba válida.`,
        );
      }
      return { carta: existing, created: false };
    }

    const asignadaEl = input.now ?? new Date();
    tx.create(ref, {
      uid,
      diseno,
      premioNombre: DISENOS_CARTA_PRUEBA[diseno],
      motivo: input.motivo?.trim() || "Prueba de visualización",
      asignadaEl: Timestamp.fromDate(asignadaEl),
    });
    return {
      carta: {
        id: ref.id,
        diseno,
        premioNombre: DISENOS_CARTA_PRUEBA[diseno],
        asignadaEl: asignadaEl.toISOString(),
      },
      created: true,
    };
  });
}

/** Retira una carta de prueba. Devuelve false si la cuenta no la tenía. */
export async function revokeCartaPrueba(input: {
  uid: string;
  diseno: string;
}): Promise<boolean> {
  const uid = requireUid(input.uid);
  const diseno = requireDiseno(input.diseno);
  const ref = firestoreApp
    .collection(CARTAS_PRUEBA_COLLECTION)
    .doc(cartaPruebaId(uid, diseno));

  return firestoreApp.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    tx.delete(ref);
    return true;
  });
}

/**
 * UID de una cuenta a partir de su correo, buscándolo en usuariosApp del
 * mismo Firestore. El correo solo sirve para encontrar la cuenta: la carta se
 * guarda con el uid.
 */
export async function findUidByEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new CartaPruebaError("Falta el correo de la cuenta.");

  const snap = await firestoreApp
    .collection("usuariosApp")
    .where("email", "==", normalized)
    .limit(2)
    .get();
  const uids = snap.docs
    .map((doc) => {
      const data = doc.data();
      return typeof data?.uid === "string" && data.uid.trim()
        ? data.uid.trim()
        : doc.id;
    })
    .filter((uid) => uid.length > 0);

  if (uids.length === 0) {
    throw new CartaPruebaError(
      "No hay ninguna cuenta con ese correo en este Firestore. Indica la cuenta con --uid.",
    );
  }
  if (uids.length > 1) {
    throw new CartaPruebaError(
      "Hay más de una cuenta con ese correo. Usa --uid para elegir la correcta.",
    );
  }
  return uids[0];
}

export default {
  listCartasPrueba,
  grantCartaPrueba,
  revokeCartaPrueba,
  findUidByEmail,
};
