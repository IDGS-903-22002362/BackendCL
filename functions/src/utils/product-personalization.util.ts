import type { Producto } from "../models/producto.model";

export const PERSONALIZATION_FEE_MXN = 300;

export type ProductPersonalizationMode = "player" | "custom";

export type ItemPersonalizacion = {
  mode: ProductPersonalizationMode;
  nombre: string;
  numero: string;
};

export function isProductPersonalizable(product: Pick<Producto, "personalizable" | "descripcion" | "clave">): boolean {
  if (product.personalizable === true) {
    return true;
  }
  if (product.personalizable === false) {
    return false;
  }

  const normalized = `${product.descripcion ?? ""} ${product.clave ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return normalized.includes("jersey");
}

export function resolvePersonalizationFeeMxn(
  product: Pick<Producto, "personalizationFeeMxn">,
): number {
  const fee = product.personalizationFeeMxn;
  return typeof fee === "number" && Number.isFinite(fee) && fee >= 0
    ? fee
    : PERSONALIZATION_FEE_MXN;
}

export function sanitizePersonalizationName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .trim()
    .slice(0, 12);
}

export function sanitizePersonalizationNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  if (!digits) {
    return "";
  }
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99) {
    return "";
  }
  return String(parsed);
}

export function normalizeItemPersonalizacion(
  input: unknown,
): ItemPersonalizacion | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const mode = record.mode === "player" || record.mode === "custom"
    ? record.mode
    : undefined;
  const nombre = sanitizePersonalizationName(
    typeof record.nombre === "string" ? record.nombre : "",
  );
  const numero = sanitizePersonalizationNumber(
    typeof record.numero === "string" ? record.numero : "",
  );

  if (!mode || !nombre || !numero) {
    return undefined;
  }

  return { mode, nombre, numero };
}

export function getPersonalizationSignature(
  personalizacion?: ItemPersonalizacion,
): string {
  if (!personalizacion) {
    return "";
  }

  return `${personalizacion.mode}:${personalizacion.nombre}:${personalizacion.numero}`;
}

export function cartItemsMatchVariant(
  left: { productoId: string; tallaId?: string; personalizacion?: ItemPersonalizacion },
  right: { productoId: string; tallaId?: string; personalizacion?: ItemPersonalizacion },
): boolean {
  if (left.productoId !== right.productoId) {
    return false;
  }

  const leftTalla = left.tallaId ?? "";
  const rightTalla = right.tallaId ?? "";
  if (leftTalla !== rightTalla) {
    return false;
  }

  return (
    getPersonalizationSignature(left.personalizacion) ===
    getPersonalizationSignature(right.personalizacion)
  );
}

export function assertPersonalizationAllowed(
  product: Producto,
  personalizacion?: ItemPersonalizacion,
): void {
  if (!personalizacion) {
    return;
  }

  if (!isProductPersonalizable(product)) {
    throw new Error("Este producto no admite personalización");
  }
}
