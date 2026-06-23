import { Producto } from "../../../models/producto.model";
import { RecomendacionCandidato } from "../../../models/recomendaciones.model";

export function diversifyCandidates(
  candidates: RecomendacionCandidato[],
  productsById: Map<string, Producto>,
  options: {
    limite: number;
    maxPorCategoria?: number;
    maxPorLinea?: number;
  },
): RecomendacionCandidato[] {
  const maxPorCategoria = options.maxPorCategoria ?? 3;
  const maxPorLinea = options.maxPorLinea ?? 4;
  const categoriaCount = new Map<string, number>();
  const lineaCount = new Map<string, number>();
  const result: RecomendacionCandidato[] = [];

  const sorted = [...candidates].sort((left, right) => right.score - left.score);

  for (const candidate of sorted) {
    if (result.length >= options.limite) {
      break;
    }

    const product = productsById.get(candidate.productoId);
    if (!product) {
      continue;
    }

    const categoriaId = String(product.categoriaId || "unknown");
    const lineaId = String(product.lineaId || "unknown");
    const currentCategoria = categoriaCount.get(categoriaId) ?? 0;
    const currentLinea = lineaCount.get(lineaId) ?? 0;

    if (currentCategoria >= maxPorCategoria || currentLinea >= maxPorLinea) {
      continue;
    }

    categoriaCount.set(categoriaId, currentCategoria + 1);
    lineaCount.set(lineaId, currentLinea + 1);
    result.push(candidate);
  }

  if (result.length < options.limite) {
    for (const candidate of sorted) {
      if (result.length >= options.limite) {
        break;
      }

      if (result.some((item) => item.productoId === candidate.productoId)) {
        continue;
      }

      if (productsById.has(candidate.productoId)) {
        result.push(candidate);
      }
    }
  }

  return result;
}

export function mergeCandidates(
  groups: RecomendacionCandidato[][],
  pesos: Record<string, number>,
): RecomendacionCandidato[] {
  const merged = new Map<string, RecomendacionCandidato>();

  for (const group of groups) {
    for (const candidate of group) {
      const weight = pesos[candidate.estrategia] ?? 1;
      const weightedScore = candidate.score * weight;
      const existing = merged.get(candidate.productoId);

      if (!existing || weightedScore > existing.score) {
        merged.set(candidate.productoId, {
          ...candidate,
          score: weightedScore,
        });
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => right.score - left.score);
}
