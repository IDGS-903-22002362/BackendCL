import { createHash } from "crypto";
import { LoyaltyChannel } from "../models/loyalty.enums";
import { LOYALTY_DEFAULTS } from "../constants/loyalty.constants";

const LEVELS = {
  BRONCE: "Bronce",
  PLATA: "Plata",
  ORO: "Oro",
  PLATINO: "Platino",
  DIAMANTE: "Diamante",
  ESMERALDA: "Esmeralda",
} as const;

export class ConversionRulesService {
  calculatePointsFromAmountCents(amountCents: number): number {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return 0;
    }
    const pesos = amountCents / 100;
    return Math.round(pesos * LOYALTY_DEFAULTS.POINTS_CONVERSION_RATE);
  }

  calculateLevel(availablePoints: number): string {
    const points = Math.max(0, Math.trunc(availablePoints));
    if (points >= 1050) return LEVELS.ESMERALDA;
    if (points >= 750) return LEVELS.DIAMANTE;
    if (points >= 450) return LEVELS.PLATINO;
    if (points >= 300) return LEVELS.ORO;
    if (points >= 150) return LEVELS.PLATA;
    return LEVELS.BRONCE;
  }

  buildExternalTxnKey(channel: LoyaltyChannel, externalTransactionId: string): string {
    return `${channel}:${externalTransactionId.trim()}`;
  }

  hashIdempotencyKey(key: string): string {
    return createHash("sha256").update(key.trim()).digest("hex");
  }

  hashRequestBody(payload: unknown): string {
    const stable = JSON.stringify(payload, Object.keys(payload as object).sort());
    return createHash("sha256").update(stable).digest("hex");
  }
}

export const conversionRulesService = new ConversionRulesService();
export default conversionRulesService;
