import {
  InventarioGlobalBuckets,
  InventarioPorTallaBuckets,
  InventarioPorTallaExtended,
} from "../models/producto.model";
import {
  completeInventarioPorTalla,
  normalizeTallaIds,
} from "./size-inventory.util";

const normalizeQty = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
};

export const computeDisponible = (
  fisica: number,
  reservada: number,
  noDisponible: number,
): number => Math.max(0, fisica - reservada - noDisponible);

export const normalizeGlobalBuckets = (
  data: Record<string, unknown>,
  fallbackExistencias: number,
): InventarioGlobalBuckets => {
  const raw = data.inventarioGlobal as InventarioGlobalBuckets | undefined;
  const fisica = normalizeQty(raw?.fisica ?? fallbackExistencias);
  const reservada = normalizeQty(raw?.reservada);
  const noDisponible = normalizeQty(raw?.noDisponible);
  const entrante = normalizeQty(raw?.entrante);
  const stockObjetivo =
    raw?.stockObjetivo === undefined
      ? undefined
      : normalizeQty(raw.stockObjetivo);

  return {
    fisica,
    reservada,
    noDisponible,
    entrante,
    stockObjetivo,
    disponible: computeDisponible(fisica, reservada, noDisponible),
  };
};

export const normalizeSizeBuckets = (
  tallaId: string,
  entry: InventarioPorTallaExtended | undefined,
  fallbackCantidad: number,
): InventarioPorTallaBuckets => {
  const fisica = normalizeQty(entry?.fisica ?? fallbackCantidad);
  const reservada = normalizeQty(entry?.reservada);
  const noDisponible = normalizeQty(entry?.noDisponible);
  const entrante = normalizeQty(entry?.entrante);

  return {
    tallaId,
    fisica,
    reservada,
    noDisponible,
    entrante,
    disponible: computeDisponible(fisica, reservada, noDisponible),
  };
};

export const projectLegacyFromProductData = (
  data: Record<string, unknown>,
): {
  tallaIds: string[];
  inventarioPorTalla: InventarioPorTallaExtended[];
  existencias: number;
  disponible: boolean;
  inventarioGlobal?: InventarioGlobalBuckets;
} => {
  const tallaIds = normalizeTallaIds(data.tallaIds);
  const inventarioRaw = Array.isArray(data.inventarioPorTalla)
    ? (data.inventarioPorTalla as InventarioPorTallaExtended[])
    : [];

  if (tallaIds.length === 0) {
    const global = normalizeGlobalBuckets(
      data,
      normalizeQty(data.existencias),
    );
    return {
      tallaIds: [],
      inventarioPorTalla: [],
      existencias: global.disponible,
      disponible: global.disponible > 0,
      inventarioGlobal: global,
    };
  }

  const completed = completeInventarioPorTalla(tallaIds, inventarioRaw);
  const inventarioPorTalla = completed.map((item) => {
    const extended = inventarioRaw.find((row) => row.tallaId === item.tallaId);
    const buckets = normalizeSizeBuckets(
      item.tallaId,
      extended,
      item.cantidad,
    );
    return {
      tallaId: item.tallaId,
      cantidad: buckets.disponible,
      fisica: buckets.fisica,
      reservada: buckets.reservada,
      noDisponible: buckets.noDisponible,
      entrante: buckets.entrante,
    };
  });

  const existencias = inventarioPorTalla.reduce(
    (acc, item) => acc + item.cantidad,
    0,
  );

  return {
    tallaIds,
    inventarioPorTalla,
    existencias,
    disponible: existencias > 0,
  };
};

export const buildFirestoreInventoryPatch = (input: {
  tallaIds: string[];
  inventarioPorTalla: InventarioPorTallaExtended[];
  inventarioGlobal?: InventarioGlobalBuckets;
}): Record<string, unknown> => {
  const patch: Record<string, unknown> = {
    tallaIds: input.tallaIds,
    inventarioPorTalla: input.inventarioPorTalla,
    existencias: input.tallaIds.length
      ? input.inventarioPorTalla.reduce((acc, row) => acc + row.cantidad, 0)
      : (input.inventarioGlobal?.disponible ?? 0),
    disponible: input.tallaIds.length
      ? input.inventarioPorTalla.some((row) => row.cantidad > 0)
      : (input.inventarioGlobal?.disponible ?? 0) > 0,
  };

  if (input.inventarioGlobal) {
    patch.inventarioGlobal = input.inventarioGlobal;
  }

  return patch;
};

export const getAvailableForVariant = (
  data: Record<string, unknown>,
  tallaId?: string | null,
): number => {
  const projection = projectLegacyFromProductData(data);
  if (projection.tallaIds.length === 0) {
    return projection.existencias;
  }

  const normalizedTallaId = tallaId?.trim();
  if (!normalizedTallaId) {
    return 0;
  }

  return (
    projection.inventarioPorTalla.find((row) => row.tallaId === normalizedTallaId)
      ?.cantidad ?? 0
  );
};
