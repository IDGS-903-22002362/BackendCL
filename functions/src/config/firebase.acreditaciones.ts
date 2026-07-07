/**
 * RTDB acreditaciones-b904f — calendario de torneos / jornadas.
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const APP_NAME = "ACREDITACIONES";

const REALTIME_DB_URL =
  process.env.REALTIME_DATABASE_URL_APP_OFICIAL2?.trim() ||
  "https://acreditaciones-b904f-default-rtdb.firebaseio.com";

class AcreditacionesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcreditacionesError";
  }
}

const resolveServiceAccountPath = (): string | null => {
  const explicit = process.env.SERVICE_ACCOUNT_APP_OFICIAL2_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const roots = [
    path.join(__dirname, "../../.."),
    path.join(__dirname, "../../../.."),
  ];

  const filenames = [
    "acreditaciones.serviceAccountKey.json",
    "acreditaciones-b904f-firebase-adminsdk-fbsvc-a7b33d0e09.json",
  ];

  for (const root of roots) {
    for (const name of filenames) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    if (fs.existsSync(root)) {
      const adminSdk = fs
        .readdirSync(root)
        .find(
          (file) =>
            file.includes("acreditaciones") &&
            file.includes("firebase-adminsdk") &&
            file.endsWith(".json"),
        );
      if (adminSdk) {
        return path.join(root, adminSdk);
      }
    }
  }

  return null;
};

function loadServiceAccount(): admin.ServiceAccount | null {
  const inline = process.env.SERVICE_ACCOUNT_APP_OFICIAL2;
  if (inline?.trim()) {
    try {
      return JSON.parse(inline) as admin.ServiceAccount;
    } catch {
      throw new AcreditacionesError(
        "SERVICE_ACCOUNT_APP_OFICIAL2 no es un JSON válido.",
      );
    }
  }

  const filePath = resolveServiceAccountPath();
  if (filePath) {
    return require(filePath) as admin.ServiceAccount;
  }

  return null;
}

function getOrCreateApp(): admin.app.App | null {
  const adminApps = Array.isArray(admin.apps) ? admin.apps : [];
  const existing = adminApps.find((a) => a?.name === APP_NAME);
  if (existing) {
    return existing;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      databaseURL: REALTIME_DB_URL,
    },
    APP_NAME,
  );
}

export function isAcreditacionesConfigured(): boolean {
  return Boolean(getOrCreateApp());
}

export function getRealtimeDbAcreditaciones(): admin.database.Database {
  const app = getOrCreateApp();
  if (!app) {
    throw new AcreditacionesError(
      "Conexión a acreditaciones-b904f no configurada. Define SERVICE_ACCOUNT_APP_OFICIAL2 y REALTIME_DATABASE_URL_APP_OFICIAL2.",
    );
  }
  return app.database();
}

export { AcreditacionesError };
