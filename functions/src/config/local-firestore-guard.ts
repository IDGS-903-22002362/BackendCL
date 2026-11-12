/**
 * Protección del servidor de desarrollo local.
 *
 * Con IS_LOCAL=true el servidor debe usar Firestore Emulator. Solo se permite
 * Firestore real si se pide de forma explícita (ALLOW_LOCAL_REAL_FIRESTORE=true)
 * y además el proyecto NO es uno de producción, es decir, un entorno
 * independiente (p. ej. un proyecto de staging propio).
 *
 * No hace nada en Cloud Functions ni cuando IS_LOCAL no es "true" (producción,
 * CI y pruebas automatizadas mantienen su comportamiento).
 */
export const PRODUCTION_FIREBASE_PROJECT_IDS: ReadonlySet<string> = new Set([
  "app-oficial-leon",
  "e-comerce-leon",
]);

export type LocalFirestoreTarget = {
  /** Nombre legible de la conexión, para el mensaje de error. */
  app: string;
  projectId: string;
};

export type LocalFirestoreDecision = "not-local" | "emulator" | "allowed-non-production";

export function assertLocalFirestoreTarget(
  target: LocalFirestoreTarget,
  env: NodeJS.ProcessEnv = process.env,
): LocalFirestoreDecision {
  const isCloudFunction = Boolean(env.FUNCTION_NAME || env.K_SERVICE);
  if (isCloudFunction || env.IS_LOCAL !== "true") return "not-local";

  if ((env.FIRESTORE_EMULATOR_HOST ?? "").trim()) return "emulator";

  const projectId = target.projectId.trim();
  const optIn = env.ALLOW_LOCAL_REAL_FIRESTORE === "true";
  if (optIn && projectId && !PRODUCTION_FIREBASE_PROJECT_IDS.has(projectId)) {
    console.warn(
      `[${target.app}] Servidor local usando Firestore real del proyecto "${projectId}" (no productivo) por ALLOW_LOCAL_REAL_FIRESTORE=true.`,
    );
    return "allowed-non-production";
  }

  const reason = optIn
    ? `ALLOW_LOCAL_REAL_FIRESTORE=true no se permite con el proyecto de producción "${projectId}".`
    : "Falta FIRESTORE_EMULATOR_HOST.";
  throw new Error(
    `[${target.app}] El servidor local (IS_LOCAL=true) no puede conectarse a Firestore de producción. ${reason} ` +
      "Arranca el emulador (npm run emulator) y usa npm run dev, que define FIRESTORE_EMULATOR_HOST=127.0.0.1:8080. " +
      "Para otro entorno, usa un proyecto independiente no productivo con ALLOW_LOCAL_REAL_FIRESTORE=true.",
  );
}
