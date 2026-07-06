import axios from "axios";

const DEFAULT_PURCHASES_URL =
  "https://api.boletomovil.com/ticketing/api/purchases";
const DEFAULT_TIMEOUT_MS = 15000;
const TARGET_EVENT = "Fierabono AP26";
const TARGET_SEASON = "Apertura 2026";
const POINTS_RATE = 0.1;

interface BoletomovilUser {
  name?: string;
  email?: string;
  phone?: string;
}

interface BoletomovilPurchaseItem {
  event?: string;
  purchaseID?: number | string;
  zone?: string;
  section?: string;
  seat?: string;
  eventDate?: string;
  season?: string;
  basePrice?: number | string;
  isSeasonPass?: number | boolean | string;
}

interface BoletomovilPurchasesResponse {
  user?: BoletomovilUser;
  items?: BoletomovilPurchaseItem[];
}

export interface SeasonPassPurchaseSummary {
  itemKey: string;
  event: string;
  purchaseID: number | string | null;
  zone: string | null;
  section: string | null;
  seat: string | null;
  eventDate: string | null;
  season: string;
  basePrice: number;
  isSeasonPass: boolean;
}

export interface SeasonPassVerificationResult {
  isSubscriber: boolean;
  season: string;
  event: string;
  phone: string;
  phoneVerified: boolean;
  purchaseCount: number;
  totalBasePrice: number;
  pointsAwarded: number;
  purchaseIds: Array<number | string>;
  itemKeys: string[];
  items: SeasonPassPurchaseSummary[];
  providerUser?: {
    name?: string;
    email?: string;
    phone?: string;
  };
}

export class SeasonPassVerificationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

class SeasonPassVerificationService {
  normalizePhone(rawPhone: string): string {
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      throw new SeasonPassVerificationError(
        "Ingresa un teléfono para verificar tu Fierabono.",
        400,
        "PHONE_REQUIRED",
      );
    }

    const digits = trimmed.replace(/\D/g, "");
    let nationalNumber: string;
    if (digits.length === 10) {
      nationalNumber = digits;
    } else if (digits.length === 12 && digits.startsWith("52")) {
      nationalNumber = digits.slice(2);
    } else {
      throw new SeasonPassVerificationError(
        "El teléfono debe tener 10 dígitos nacionales de México.",
        400,
        "INVALID_PHONE",
      );
    }

    const normalized = `+52${nationalNumber}`;
    if (!/^\+52\d{10}$/.test(normalized)) {
      throw new SeasonPassVerificationError(
        "El teléfono debe tener 10 dígitos nacionales de México.",
        400,
        "INVALID_PHONE",
      );
    }

    return normalized;
  }

  private tryNormalizePhone(rawPhone?: string): string | null {
    if (!rawPhone) {
      return null;
    }

    try {
      return this.normalizePhone(rawPhone);
    } catch {
      return null;
    }
  }

  private getConfig(): { url: string; token: string; timeoutMs: number } {
    const token = process.env.BOLETOMOVIL_API_TOKEN?.trim();
    if (!token) {
      throw new SeasonPassVerificationError(
        "La verificación de abonados no está configurada.",
        500,
        "PROVIDER_CONFIG_MISSING",
      );
    }

    const timeoutMs = Number(process.env.BOLETOMOVIL_TIMEOUT_MS);
    return {
      url: process.env.BOLETOMOVIL_PURCHASES_URL?.trim() || DEFAULT_PURCHASES_URL,
      token,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.trunc(timeoutMs)
          : DEFAULT_TIMEOUT_MS,
    };
  }

  private isTargetSeasonPass(item: BoletomovilPurchaseItem): boolean {
    const eventMatches = item.event?.trim().toLowerCase() ===
      TARGET_EVENT.toLowerCase();
    const seasonMatches = item.season?.trim().toLowerCase() ===
      TARGET_SEASON.toLowerCase();
    const isSeasonPass =
      item.isSeasonPass === true ||
      item.isSeasonPass === 1 ||
      item.isSeasonPass === "1";

    return eventMatches && (seasonMatches || isSeasonPass);
  }

  private toSummary(item: BoletomovilPurchaseItem): SeasonPassPurchaseSummary {
    const basePrice = Number(item.basePrice ?? 0);
    const purchaseID = item.purchaseID ?? null;
    const section = item.section?.trim() || null;
    const seat = item.seat?.trim() || null;

    return {
      itemKey: this.buildItemKey({ purchaseID, section, seat }),
      event: item.event?.trim() || TARGET_EVENT,
      purchaseID,
      zone: item.zone?.trim() || null,
      section,
      seat,
      eventDate: item.eventDate?.trim() || null,
      season: item.season?.trim() || TARGET_SEASON,
      basePrice: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0,
      isSeasonPass:
        item.isSeasonPass === true ||
        item.isSeasonPass === 1 ||
        item.isSeasonPass === "1",
    };
  }

  private buildItemKey(input: {
    purchaseID: number | string | null;
    section: string | null;
    seat: string | null;
  }): string {
    return [
      input.purchaseID ?? "sin-purchase",
      input.section ?? "sin-seccion",
      input.seat ?? "sin-asiento",
    ]
      .map((value) => String(value).trim().toLowerCase())
      .join("|");
  }

  async verifyByPhone(rawPhone: string): Promise<SeasonPassVerificationResult> {
    const phone = this.normalizePhone(rawPhone);
    const config = this.getConfig();

    let providerResponse: BoletomovilPurchasesResponse;
    try {
      const response = await axios.post<BoletomovilPurchasesResponse>(
        config.url,
        {
          filters: { phone },
          limit: 500,
          offset: 0,
        },
        {
          timeout: config.timeoutMs,
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "leonfc",
          },
        },
      );
      providerResponse = response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const providerMessage =
          typeof error.response?.data?.error === "string"
            ? error.response.data.error
            : typeof error.response?.data?.message === "string"
              ? error.response.data.message
              : "";

        if (error.response?.status === 401) {
          throw new SeasonPassVerificationError(
            "No se pudo autenticar con el proveedor de boletos.",
            502,
            "PROVIDER_UNAUTHORIZED",
          );
        }

        if (
          error.response?.status === 429 ||
          providerMessage.toLowerCase().includes("demasiadas solicitudes")
        ) {
          throw new SeasonPassVerificationError(
            "Boletomóvil está limitando las solicitudes. Intenta de nuevo en unos minutos.",
            429,
            "PROVIDER_RATE_LIMITED",
          );
        }
      }

      throw new SeasonPassVerificationError(
        "No se pudo contactar el proveedor de boletos. Intenta más tarde.",
        502,
        "PROVIDER_UNAVAILABLE",
      );
    }

    const items = Array.isArray(providerResponse.items)
      ? providerResponse.items
      : [];
    const providerPhone = this.tryNormalizePhone(providerResponse.user?.phone);
    const belongsToRequestedPhone = providerPhone === phone;

    if (!belongsToRequestedPhone) {
      return {
        isSubscriber: false,
        season: TARGET_SEASON,
        event: TARGET_EVENT,
        phone,
        phoneVerified: false,
        purchaseCount: 0,
        totalBasePrice: 0,
        pointsAwarded: 0,
        purchaseIds: [],
        itemKeys: [],
        items: [],
        providerUser: providerResponse.user,
      };
    }

    const matchingItems = items
      .filter((item) => this.isTargetSeasonPass(item))
      .map((item) => this.toSummary(item));
    const totalBasePrice = matchingItems.reduce(
      (sum, item) => sum + item.basePrice,
      0,
    );
    const purchaseIds = Array.from(
      new Set(
        matchingItems
          .map((item) => item.purchaseID)
          .filter((id): id is number | string => id !== null),
      ),
    );
    const itemKeys = matchingItems.map((item) => item.itemKey);

    return {
      isSubscriber: matchingItems.length > 0,
      season: TARGET_SEASON,
      event: TARGET_EVENT,
      phone,
      phoneVerified: false,
      purchaseCount: matchingItems.length,
      totalBasePrice,
      pointsAwarded: Math.round(totalBasePrice * POINTS_RATE),
      purchaseIds,
      itemKeys,
      items: matchingItems,
      providerUser: providerResponse.user,
    };
  }
}

export const seasonPassVerificationService =
  new SeasonPassVerificationService();
export default seasonPassVerificationService;
