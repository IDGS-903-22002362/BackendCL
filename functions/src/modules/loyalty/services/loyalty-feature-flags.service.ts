import { firestoreApp } from "../../../config/app.firebase";

export type LoyaltyFeatureFlags = {
  loyaltyV1ReadsEnabled: boolean;
  loyaltyV1WritesEnabled: boolean;
  loyaltyPhysicalEarnEnabled: boolean;
  loyaltyDigitalEarnEnabled: boolean;
  loyaltyRedemptionsEnabled: boolean;
  loyaltyReversalsEnabled: boolean;
  legacyPointsAdaptersEnabled: boolean;
};

const DEFAULT_FLAGS: LoyaltyFeatureFlags = {
  loyaltyV1ReadsEnabled: true,
  loyaltyV1WritesEnabled: true,
  loyaltyPhysicalEarnEnabled: true,
  loyaltyDigitalEarnEnabled: true,
  loyaltyRedemptionsEnabled: true,
  loyaltyReversalsEnabled: true,
  legacyPointsAdaptersEnabled: true,
};

const ENV_MAP: Record<keyof LoyaltyFeatureFlags, string> = {
  loyaltyV1ReadsEnabled: "LOYALTY_V1_READS_ENABLED",
  loyaltyV1WritesEnabled: "LOYALTY_V1_WRITES_ENABLED",
  loyaltyPhysicalEarnEnabled: "LOYALTY_PHYSICAL_EARN_ENABLED",
  loyaltyDigitalEarnEnabled: "LOYALTY_DIGITAL_EARN_ENABLED",
  loyaltyRedemptionsEnabled: "LOYALTY_REDEMPTIONS_ENABLED",
  loyaltyReversalsEnabled: "LOYALTY_REVERSALS_ENABLED",
  legacyPointsAdaptersEnabled: "LOYALTY_LEGACY_ADAPTERS_ENABLED",
};

function parseEnvBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

let cachedFlags: LoyaltyFeatureFlags | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

export class LoyaltyFeatureFlagsService {
  async getFlags(): Promise<LoyaltyFeatureFlags> {
    const now = Date.now();
    if (cachedFlags && now < cacheExpiresAt) {
      return cachedFlags;
    }

    let remote: Partial<LoyaltyFeatureFlags> = {};
    try {
      const snap = await firestoreApp
        .collection("configuracion")
        .doc("loyalty")
        .get();
      if (snap.exists) {
        remote = snap.data() as Partial<LoyaltyFeatureFlags>;
      }
    } catch {
      // use defaults + env
    }

    const merged = { ...DEFAULT_FLAGS, ...remote };
    const flags = {} as LoyaltyFeatureFlags;
    for (const key of Object.keys(DEFAULT_FLAGS) as (keyof LoyaltyFeatureFlags)[]) {
      flags[key] = parseEnvBool(process.env[ENV_MAP[key]], merged[key]);
    }

    cachedFlags = flags;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return flags;
  }

  clearCache(): void {
    cachedFlags = null;
    cacheExpiresAt = 0;
  }
}

export const loyaltyFeatureFlagsService = new LoyaltyFeatureFlagsService();
export default loyaltyFeatureFlagsService;

export async function requireLoyaltyWrites(): Promise<void> {
  const flags = await loyaltyFeatureFlagsService.getFlags();
  if (!flags.loyaltyV1WritesEnabled) {
    const LoyaltyProblemError = (await import("../errors/loyalty-problem.error")).default;
    throw new LoyaltyProblemError(
      "SERVICE_UNAVAILABLE",
      "Las operaciones de lealtad estan temporalmente deshabilitadas",
    );
  }
}

export async function requireLegacyAdapters(): Promise<void> {
  const flags = await loyaltyFeatureFlagsService.getFlags();
  if (!flags.legacyPointsAdaptersEnabled) {
    const LoyaltyProblemError = (await import("../errors/loyalty-problem.error")).default;
    throw new LoyaltyProblemError(
      "SERVICE_UNAVAILABLE",
      "Los adaptadores legacy estan temporalmente deshabilitados",
    );
  }
}
