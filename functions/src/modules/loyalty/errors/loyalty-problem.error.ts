import { LOYALTY_PROBLEM_BASE_URI } from "../constants/loyalty.constants";

export type LoyaltyProblemCode =
  | "MEMBER_NOT_FOUND"
  | "INVALID_AMOUNT"
  | "DUPLICATE_TRANSACTION"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "INSUFFICIENT_POINTS"
  | "FORBIDDEN"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_NOT_REVERSIBLE"
  | "REVERSAL_EXCEEDS_ORIGINAL"
  | "REDEMPTION_NOT_FOUND"
  | "REDEMPTION_ALREADY_CONFIRMED"
  | "REDEMPTION_EXPIRED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const PROBLEM_META: Record<
  LoyaltyProblemCode,
  { status: number; title: string; detail: string }
> = {
  MEMBER_NOT_FOUND: {
    status: 404,
    title: "Miembro no encontrado",
    detail: "No existe un miembro de lealtad con el identificador solicitado.",
  },
  INVALID_AMOUNT: {
    status: 400,
    title: "Monto o puntos invalidos",
    detail: "El monto o la cantidad de puntos no es valida para esta operacion.",
  },
  DUPLICATE_TRANSACTION: {
    status: 409,
    title: "Transaccion duplicada",
    detail: "La transaccion externa ya fue registrada.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    title: "Conflicto de idempotencia",
    detail: "La clave de idempotencia ya fue usada con un cuerpo distinto.",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    title: "Clave de idempotencia requerida",
    detail: "Debes enviar el encabezado Idempotency-Key.",
  },
  INSUFFICIENT_POINTS: {
    status: 409,
    title: "Puntos insuficientes",
    detail: "El monedero no tiene puntos suficientes para completar la operacion.",
  },
  FORBIDDEN: {
    status: 403,
    title: "Acceso denegado",
    detail: "No tienes permisos para realizar esta operacion de lealtad.",
  },
  TRANSACTION_NOT_FOUND: {
    status: 404,
    title: "Transaccion no encontrada",
    detail: "No existe la transaccion solicitada.",
  },
  TRANSACTION_NOT_REVERSIBLE: {
    status: 409,
    title: "Transaccion no reversible",
    detail: "La transaccion no puede revertirse en su estado actual.",
  },
  REVERSAL_EXCEEDS_ORIGINAL: {
    status: 400,
    title: "Reversion excede el original",
    detail: "Los puntos a revertir exceden el saldo reversible de la transaccion.",
  },
  REDEMPTION_NOT_FOUND: {
    status: 404,
    title: "Canje no encontrado",
    detail: "No existe el canje solicitado.",
  },
  REDEMPTION_ALREADY_CONFIRMED: {
    status: 409,
    title: "Canje ya confirmado",
    detail: "El canje ya fue confirmado y no puede modificarse.",
  },
  REDEMPTION_EXPIRED: {
    status: 409,
    title: "Canje expirado",
    detail: "La reserva de canje expiro o ya no esta pendiente.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: "Servicio no disponible",
    detail: "La operacion de lealtad esta temporalmente deshabilitada.",
  },
  INTERNAL_ERROR: {
    status: 500,
    title: "Error interno de lealtad",
    detail: "Ocurrio un error inesperado al procesar la solicitud.",
  },
};

export default class LoyaltyProblemError extends Error {
  readonly code: LoyaltyProblemCode;
  readonly status: number;
  readonly title: string;
  readonly type: string;

  constructor(code: LoyaltyProblemCode, detail?: string) {
    const meta = PROBLEM_META[code];
    super(detail ?? meta.detail);
    this.name = "LoyaltyProblemError";
    this.code = code;
    this.status = meta.status;
    this.title = meta.title;
    this.type = `${LOYALTY_PROBLEM_BASE_URI}/${code.toLowerCase()}`;
  }

  toProblemJson(instance?: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      code: this.code,
      ...(instance ? { instance } : {}),
    };
  }
}
