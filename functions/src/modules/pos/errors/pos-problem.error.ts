/**
 * Errores de dominio del POS serializados como `application/problem+json` (RFC 7807),
 * siguiendo el patrón de `modules/loyalty/errors/loyalty-problem.error.ts`.
 */

import { POS_PROBLEM_BASE_URI } from "../constants/pos.constants";

export type PosProblemCode =
  | "POS_PERMISSION_DENIED"
  | "POS_ACCESS_DENIED"
  | "POS_RESOURCE_NOT_FOUND"
  | "POS_VALIDATION_ERROR"
  | "APP_CHECK_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "CONCURRENT_MODIFICATION"
  | "INVALID_STATE_TRANSITION"
  | "SELF_APPROVAL_FORBIDDEN"
  | "AUTHORIZER_REQUIRED"
  | "REASON_REQUIRED"
  | "REGISTER_ALREADY_OPEN"
  | "REGISTER_NOT_OPEN"
  | "REGISTER_BLOCKED"
  | "REGISTER_ARCHIVED"
  | "REGISTER_CODE_TAKEN"
  | "REGISTER_HAS_PENDING_WORK"
  | "ACTIVE_SHIFT_EXISTS"
  | "NO_ACTIVE_SHIFT"
  | "SHIFT_NOT_OWNED"
  | "SHIFT_HAS_PENDING_WORK"
  | "HANDOFF_NOT_PENDING"
  | "SALE_NOT_EDITABLE"
  | "SALE_EMPTY"
  | "SALE_ALREADY_PAID"
  | "SALE_PAYMENT_INCOMPLETE"
  | "SALE_LIMIT_EXCEEDED"
  | "SALE_ITEM_NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "PRODUCT_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "PROMOTION_CHANGED"
  | "PROMOTION_CODE_INVALID"
  | "PROMOTION_CODE_NOT_COMBINABLE"
  | "MANUAL_DISCOUNT_LIMIT_EXCEEDED"
  | "PAYMENT_DUPLICATE"
  | "PAYMENT_AMOUNT_MISMATCH"
  | "PAYMENT_METHOD_NOT_ALLOWED"
  | "PAYMENT_NOT_PENDING"
  | "PAYMENT_REFERENCE_ALREADY_USED"
  | "CASH_RECEIVED_INSUFFICIENT"
  | "CASH_MOVEMENT_LIMIT_EXCEEDED"
  | "CASH_MOVEMENT_NOT_PENDING"
  | "TRANSFER_NOT_RECEIVED"
  | "TRANSFER_INVALID_TARGET"
  | "CASH_COUNT_ALREADY_SUBMITTED"
  | "CASH_COUNT_BLIND_RESULT_HIDDEN"
  | "CUT_NOT_REVIEWABLE"
  | "CUT_APPROVAL_LEVEL_REQUIRED"
  | "CUT_ALREADY_APPROVED"
  | "DAILY_CLOSE_BLOCKED"
  | "DAILY_CLOSE_ALREADY_EXISTS"
  | "DAILY_CLOSE_NOT_FOUND"
  | "RETURN_QUANTITY_EXCEEDED"
  | "RETURN_NOT_ACTIONABLE"
  | "REFUND_AMOUNT_EXCEEDED"
  | "INCIDENT_NOT_ACTIONABLE"
  | "EXPORT_RANGE_TOO_LARGE"
  | "EXPORT_NOT_READY"
  | "EXPORT_EXPIRED"
  | "SETTINGS_INVALID"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

interface PosProblemMeta {
  status: number;
  title: string;
  detail: string;
}

const PROBLEM_META: Record<PosProblemCode, PosProblemMeta> = {
  POS_PERMISSION_DENIED: {
    status: 403,
    title: "Permiso insuficiente",
    detail: "No cuentas con la capacidad requerida para esta operación.",
  },
  POS_ACCESS_DENIED: {
    status: 403,
    title: "Acceso al POS denegado",
    detail: "Tu cuenta no tiene acceso al punto de venta.",
  },
  POS_RESOURCE_NOT_FOUND: {
    status: 404,
    title: "Recurso no encontrado",
    detail: "El recurso solicitado no existe o no está disponible para tu alcance.",
  },
  POS_VALIDATION_ERROR: {
    status: 400,
    title: "Datos inválidos",
    detail: "La solicitud contiene datos inválidos.",
  },
  APP_CHECK_REQUIRED: {
    status: 401,
    title: "App Check requerido",
    detail: "Se requiere un token de App Check válido para operar el punto de venta.",
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    title: "Autenticación requerida",
    detail: "Se requiere una sesión autenticada.",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    title: "Idempotency-Key requerido",
    detail: "Esta operación requiere el header Idempotency-Key.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    title: "Conflicto de idempotencia",
    detail: "La misma Idempotency-Key ya se usó con un payload diferente.",
  },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    title: "Operación en proceso",
    detail: "Una operación con la misma Idempotency-Key está en proceso. Reintenta en unos segundos.",
  },
  CONCURRENT_MODIFICATION: {
    status: 409,
    title: "Modificación concurrente",
    detail: "El recurso cambió mientras procesabas la operación. Vuelve a cargarlo e inténtalo de nuevo.",
  },
  INVALID_STATE_TRANSITION: {
    status: 409,
    title: "Transición de estado inválida",
    detail: "La operación no es válida para el estado actual del recurso.",
  },
  SELF_APPROVAL_FORBIDDEN: {
    status: 403,
    title: "Autoaprobación no permitida",
    detail: "No puedes autorizar una operación que tú mismo solicitaste.",
  },
  AUTHORIZER_REQUIRED: {
    status: 403,
    title: "Autorizador requerido",
    detail: "La operación excede tu límite y requiere la autorización de otro usuario.",
  },
  REASON_REQUIRED: {
    status: 400,
    title: "Motivo requerido",
    detail: "La operación requiere un motivo explícito.",
  },
  REGISTER_ALREADY_OPEN: {
    status: 409,
    title: "Caja ya abierta",
    detail: "La caja ya tiene una sesión activa.",
  },
  REGISTER_NOT_OPEN: {
    status: 409,
    title: "Caja no abierta",
    detail: "La caja no tiene una sesión activa.",
  },
  REGISTER_BLOCKED: {
    status: 409,
    title: "Caja bloqueada",
    detail: "La caja está bloqueada y no puede operar.",
  },
  REGISTER_ARCHIVED: {
    status: 409,
    title: "Caja archivada",
    detail: "La caja está archivada.",
  },
  REGISTER_CODE_TAKEN: {
    status: 409,
    title: "Código de caja en uso",
    detail: "Ya existe una caja con ese código.",
  },
  REGISTER_HAS_PENDING_WORK: {
    status: 409,
    title: "Caja con pendientes",
    detail: "La caja tiene ventas, turnos o movimientos sin resolver.",
  },
  ACTIVE_SHIFT_EXISTS: {
    status: 409,
    title: "Turno activo existente",
    detail: "Ya existe un turno activo para este cajero o esta caja.",
  },
  NO_ACTIVE_SHIFT: {
    status: 409,
    title: "Sin turno activo",
    detail: "No tienes un turno activo en esta caja.",
  },
  SHIFT_NOT_OWNED: {
    status: 403,
    title: "Turno de otro cajero",
    detail: "Solo puedes operar tu propio turno activo.",
  },
  SHIFT_HAS_PENDING_WORK: {
    status: 409,
    title: "Turno con pendientes",
    detail: "El turno tiene ventas o movimientos sin resolver.",
  },
  HANDOFF_NOT_PENDING: {
    status: 409,
    title: "Entrega no solicitada",
    detail: "No existe una entrega de turno pendiente de confirmación.",
  },
  SALE_NOT_EDITABLE: {
    status: 409,
    title: "Venta no editable",
    detail: "La venta no admite modificaciones en su estado actual.",
  },
  SALE_EMPTY: {
    status: 409,
    title: "Venta sin productos",
    detail: "La venta no tiene líneas para cobrar.",
  },
  SALE_ALREADY_PAID: {
    status: 409,
    title: "Venta ya pagada",
    detail: "La venta ya está pagada.",
  },
  SALE_PAYMENT_INCOMPLETE: {
    status: 409,
    title: "Pago incompleto",
    detail: "El total de la venta no está cubierto por pagos aprobados.",
  },
  SALE_LIMIT_EXCEEDED: {
    status: 422,
    title: "Límite de venta excedido",
    detail: "La venta excede un límite configurado del punto de venta.",
  },
  SALE_ITEM_NOT_FOUND: {
    status: 404,
    title: "Línea no encontrada",
    detail: "La línea indicada no existe en la venta.",
  },
  INSUFFICIENT_STOCK: {
    status: 409,
    title: "Inventario insuficiente",
    detail: "No hay existencias suficientes para completar la operación.",
  },
  PRODUCT_UNAVAILABLE: {
    status: 409,
    title: "Producto no disponible",
    detail: "El producto no está activo o no admite la talla indicada.",
  },
  PRICE_CHANGED: {
    status: 409,
    title: "El precio cambió",
    detail: "El precio calculado cambió respecto al mostrado. Revisa la venta antes de cobrar.",
  },
  PROMOTION_CHANGED: {
    status: 409,
    title: "La promoción cambió",
    detail: "Las promociones aplicables cambiaron. Revisa la venta antes de cobrar.",
  },
  PROMOTION_CODE_INVALID: {
    status: 422,
    title: "Código promocional inválido",
    detail: "El código promocional no es válido para esta venta.",
  },
  PROMOTION_CODE_NOT_COMBINABLE: {
    status: 422,
    title: "Código no combinable",
    detail: "El código no es acumulable con las ofertas aplicadas a esta venta.",
  },
  MANUAL_DISCOUNT_LIMIT_EXCEEDED: {
    status: 422,
    title: "Descuento manual excedido",
    detail: "El descuento manual excede el límite permitido.",
  },
  PAYMENT_DUPLICATE: {
    status: 409,
    title: "Pago duplicado",
    detail: "El pago ya fue registrado previamente.",
  },
  PAYMENT_AMOUNT_MISMATCH: {
    status: 422,
    title: "Monto de pago inconsistente",
    detail: "El monto del pago no coincide con el saldo pendiente calculado por el backend.",
  },
  PAYMENT_METHOD_NOT_ALLOWED: {
    status: 422,
    title: "Método de pago no permitido",
    detail: "La caja no admite este método de pago.",
  },
  PAYMENT_NOT_PENDING: {
    status: 409,
    title: "Pago no pendiente",
    detail: "El pago no está en un estado que permita esta operación.",
  },
  PAYMENT_REFERENCE_ALREADY_USED: {
    status: 409,
    title: "Referencia ya utilizada",
    detail: "La referencia de terminal ya fue registrada en otro pago.",
  },
  CASH_RECEIVED_INSUFFICIENT: {
    status: 422,
    title: "Efectivo insuficiente",
    detail: "El efectivo recibido es menor al monto a cobrar.",
  },
  CASH_MOVEMENT_LIMIT_EXCEEDED: {
    status: 422,
    title: "Límite de movimiento excedido",
    detail: "El importe excede el límite configurado para este tipo de movimiento.",
  },
  CASH_MOVEMENT_NOT_PENDING: {
    status: 409,
    title: "Movimiento no pendiente",
    detail: "El movimiento no está en un estado que permita esta operación.",
  },
  TRANSFER_NOT_RECEIVED: {
    status: 409,
    title: "Transferencia sin recibir",
    detail: "Existe una transferencia despachada que aún no fue confirmada como recibida.",
  },
  TRANSFER_INVALID_TARGET: {
    status: 422,
    title: "Destino de transferencia inválido",
    detail: "La caja destino no existe, está archivada o coincide con la caja origen.",
  },
  CASH_COUNT_ALREADY_SUBMITTED: {
    status: 409,
    title: "Conteo ya enviado",
    detail: "El conteo ya fue enviado y no admite modificaciones.",
  },
  CASH_COUNT_BLIND_RESULT_HIDDEN: {
    status: 403,
    title: "Resultado no disponible",
    detail: "El resultado del arqueo no está disponible para tu rol antes de la revisión.",
  },
  CUT_NOT_REVIEWABLE: {
    status: 409,
    title: "Corte no revisable",
    detail: "El corte no está en un estado que admita revisión.",
  },
  CUT_APPROVAL_LEVEL_REQUIRED: {
    status: 403,
    title: "Nivel de aprobación insuficiente",
    detail: "La diferencia del corte requiere aprobación de un nivel superior.",
  },
  CUT_ALREADY_APPROVED: {
    status: 409,
    title: "Corte ya aprobado",
    detail: "El corte ya fue aprobado y no puede editarse.",
  },
  DAILY_CLOSE_BLOCKED: {
    status: 409,
    title: "Cierre diario bloqueado",
    detail: "Existen bloqueos que impiden el cierre del día.",
  },
  DAILY_CLOSE_ALREADY_EXISTS: {
    status: 409,
    title: "Cierre diario existente",
    detail: "Ya existe un cierre para esta fecha operativa.",
  },
  DAILY_CLOSE_NOT_FOUND: {
    status: 404,
    title: "Cierre diario no encontrado",
    detail: "No existe un cierre para esta fecha operativa.",
  },
  RETURN_QUANTITY_EXCEEDED: {
    status: 422,
    title: "Cantidad de devolución excedida",
    detail: "No puedes devolver más unidades de las vendidas.",
  },
  RETURN_NOT_ACTIONABLE: {
    status: 409,
    title: "Devolución no accionable",
    detail: "La devolución no está en un estado que admita esta operación.",
  },
  REFUND_AMOUNT_EXCEEDED: {
    status: 422,
    title: "Monto de reembolso excedido",
    detail: "No puedes reembolsar más dinero del efectivamente pagado.",
  },
  INCIDENT_NOT_ACTIONABLE: {
    status: 409,
    title: "Incidencia no accionable",
    detail: "La incidencia no está en un estado que admita esta operación.",
  },
  EXPORT_RANGE_TOO_LARGE: {
    status: 422,
    title: "Rango de exportación excesivo",
    detail: "El rango solicitado excede los límites de exportación configurados.",
  },
  EXPORT_NOT_READY: {
    status: 409,
    title: "Exportación no lista",
    detail: "La exportación aún no está completada.",
  },
  EXPORT_EXPIRED: {
    status: 410,
    title: "Exportación expirada",
    detail: "La exportación expiró y su contenido ya no está disponible.",
  },
  SETTINGS_INVALID: {
    status: 422,
    title: "Configuración inválida",
    detail: "La configuración enviada no es consistente.",
  },
  RATE_LIMITED: {
    status: 429,
    title: "Demasiadas solicitudes",
    detail: "Se excedió el límite de solicitudes. Reintenta en unos segundos.",
  },
  INTERNAL_ERROR: {
    status: 500,
    title: "Error interno",
    detail: "Ocurrió un error inesperado al procesar la operación.",
  },
};

export interface PosProblemJson {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: PosProblemCode;
  instance?: string;
  requestId?: string;
  errors?: unknown;
}

export default class PosProblemError extends Error {
  readonly code: PosProblemCode;
  readonly status: number;
  readonly title: string;
  readonly type: string;
  /** Información adicional segura para el cliente (nunca datos sensibles). */
  readonly errors?: unknown;

  constructor(code: PosProblemCode, detail?: string, errors?: unknown) {
    const meta = PROBLEM_META[code];
    super(detail ?? meta.detail);
    this.name = "PosProblemError";
    this.code = code;
    this.status = meta.status;
    this.title = meta.title;
    this.type = `${POS_PROBLEM_BASE_URI}/${code.toLowerCase().replace(/_/g, "-")}`;
    this.errors = errors;
  }

  toProblemJson(instance?: string, requestId?: string): PosProblemJson {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      code: this.code,
      ...(instance ? { instance } : {}),
      ...(requestId ? { requestId } : {}),
      ...(this.errors === undefined ? {} : { errors: this.errors }),
    };
  }
}

export function posProblem(
  code: PosProblemCode,
  detail?: string,
  errors?: unknown,
): PosProblemError {
  return new PosProblemError(code, detail, errors);
}

export function isPosProblemError(error: unknown): error is PosProblemError {
  return error instanceof PosProblemError;
}

export const POS_PROBLEM_STATUS_BY_CODE: Readonly<Record<PosProblemCode, number>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(PROBLEM_META) as PosProblemCode[]).map((code) => [
        code,
        PROBLEM_META[code].status,
      ]),
    ) as Record<PosProblemCode, number>,
  );
