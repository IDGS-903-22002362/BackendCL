import { InventarioPorTalla } from "../models/producto.model";

const normalizeCantidad = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
};

export const normalizeTallaIds = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  const ids = input
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);

  return [...new Set(ids)];
};

export const normalizeInventarioPorTallaEntries = (
  input: unknown,
): InventarioPorTalla[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(
      (item): item is { tallaId: unknown; cantidad: unknown } =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      tallaId: String(item.tallaId ?? "").trim(),
      cantidad: normalizeCantidad(item.cantidad),
    }))
    .filter((item) => item.tallaId.length > 0);
};

const createInventoryMap = (
  inventarioPorTalla: InventarioPorTalla[],
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const item of inventarioPorTalla) {
    map.set(item.tallaId, item.cantidad);
  }
  return map;
};

type CompleteSizeInventoryOptions = {
  failOnUnknownSize?: boolean;
  failWhenNoSizes?: boolean;
};

export const completeInventarioPorTalla = (
  tallaIdsInput: unknown,
  inventarioInput: unknown,
  options: CompleteSizeInventoryOptions = {},
): InventarioPorTalla[] => {
  const tallaIds = normalizeTallaIds(tallaIdsInput);
  const inventario = normalizeInventarioPorTallaEntries(inventarioInput);
  const sizeSet = new Set(tallaIds);

  if (tallaIds.length === 0) {
    if (options.failWhenNoSizes && inventario.length > 0) {
      throw new Error(
        "Este producto no maneja inventario por talla; no envíes inventarioPorTalla",
      );
    }

    return [];
  }

  const inventarioMap = new Map<string, number>();
  for (const item of inventario) {
    if (!sizeSet.has(item.tallaId)) {
      if (options.failOnUnknownSize) {
        throw new Error(
          `La talla "${item.tallaId}" no pertenece al producto y no puede usarse en inventarioPorTalla`,
        );
      }
      continue;
    }
    inventarioMap.set(item.tallaId, item.cantidad);
  }

  return tallaIds.map((tallaId) => ({
    tallaId,
    cantidad: inventarioMap.get(tallaId) ?? 0,
  }));
};

export const deriveExistenciasFromSizeInventory = (
  tallaIdsInput: unknown,
  inventarioInput: unknown,
  fallbackExistencias: unknown,
): number => {
  const tallaIds = normalizeTallaIds(tallaIdsInput);
  if (tallaIds.length === 0) {
    return normalizeCantidad(fallbackExistencias);
  }

  const inventarioPorTalla = completeInventarioPorTalla(
    tallaIds,
    inventarioInput,
  );
  return inventarioPorTalla.reduce((acc, item) => acc + item.cantidad, 0);
};

export const getCantidadDisponiblePorTalla = (
  inventarioInput: unknown,
  tallaId: string,
): number => {
  const inventario = normalizeInventarioPorTallaEntries(inventarioInput);
  const map = createInventoryMap(inventario);
  return map.get(tallaId) ?? 0;
};
