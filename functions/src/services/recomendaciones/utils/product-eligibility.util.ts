import { Producto } from "../../../models/producto.model";

export function isProductoElegible(product: Producto | null | undefined): boolean {
  if (!product || product.activo !== true) {
    return false;
  }

  const precio = Number(product.precioPublico || 0);
  if (!Number.isFinite(precio) || precio <= 0) {
    return false;
  }

  const stock = Math.max(0, Math.floor(Number(product.existencias || 0)));
  const disponible =
    typeof product.disponible === "boolean" ? product.disponible : stock > 0;

  return disponible;
}

export function filterElegibleProductIds(
  products: Array<Producto | null | undefined>,
): string[] {
  return products
    .filter((product): product is Producto => isProductoElegible(product))
    .map((product) => String(product.id || "").trim())
    .filter(Boolean);
}

export function uniqueProductIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    const normalized = String(id || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function excludeProductIds(
  ids: string[],
  exclusionIds: string[] = [],
): string[] {
  const exclusions = new Set(exclusionIds.map((id) => String(id).trim()));
  return uniqueProductIds(ids).filter((id) => !exclusions.has(id));
}
