import { execSync } from "child_process";

const limpiarTexto = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const resolverProjectId = (): string =>
  process.env.APP_OFICIAL_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "app-oficial-leon";

/**
 * En Cloud Functions Firebase inyecta los secrets en process.env.
 * En scripts locales, intenta leerlos desde Secret Manager via Firebase CLI.
 */
export const loadMissingLocalSecrets = (secretNames: readonly string[]): void => {
  if (process.env.FUNCTION_NAME || process.env.K_SERVICE) {
    return;
  }

  const projectId = resolverProjectId();

  for (const secretName of secretNames) {
    if (limpiarTexto(process.env[secretName])) {
      continue;
    }

    try {
      const value = execSync(
        `firebase functions:secrets:access ${secretName} --project ${projectId}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();

      if (value) {
        process.env[secretName] = value;
      }
    } catch {
      // El script que consume el secret validara mas adelante.
    }
  }
};
