export const FEDEX_PRODUCT_DIMENSIONS_MISSING =
  "FEDEX_PRODUCT_DIMENSIONS_MISSING";
export const FEDEX_PRODUCT_LIMITS_EXCEEDED = "FEDEX_PRODUCT_LIMITS_EXCEEDED";

export type FedexPackageType = "YOUR_PACKAGING";
export type FedexPackingStrategy = "PER_UNIT" | "SIMPLE_CONSOLIDATED";

export type FedexProductPackageInput = {
  productId: string;
  name: string;
  quantity: number;
  price?: number;
  categoryId?: string;
  rawProduct: any;
};

export type FedexPackageDimensions = {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type FedexRequestedPackageLineItem = {
  sequenceNumber: string;
  weight: {
    units: "KG";
    value: number;
  };
  dimensions: {
    length: number;
    width: number;
    height: number;
    units: "CM";
  };
  customerReferences?: Array<{
    customerReferenceType: "CUSTOMER_REFERENCE";
    value: string;
  }>;
};

export type FedexCartPackageBuildResult = {
  requiresShipping: boolean;
  packages: FedexPackageDimensions[];
  requestedPackageLineItems: FedexRequestedPackageLineItem[];
  warnings: string[];
};

export class FedexPackageValidationError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code: string, statusCode = 422) {
    super(message);
    this.name = "FedexPackageValidationError";
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const MAX_WEIGHT_KG = 68;
const MAX_LENGTH_CM = 270;
const MAX_LENGTH_PLUS_GIRTH_CM = 330;

const DEFAULT_PACKAGES = [
  {
    matcher: /TARRO/,
    dimensions: { weightKg: 0.9, lengthCm: 20, widthCm: 20, heightCm: 20 },
  },
  {
    matcher: /JERSEY/,
    dimensions: { weightKg: 0.35, lengthCm: 35, widthCm: 28, heightCm: 5 },
  },
  {
    matcher: /PLAYERA/,
    dimensions: { weightKg: 0.35, lengthCm: 35, widthCm: 28, heightCm: 5 },
  },
  {
    matcher: /GORRA/,
    dimensions: { weightKg: 0.3, lengthCm: 25, widthCm: 20, heightCm: 15 },
  },
  {
    matcher: /BUFANDA/,
    dimensions: { weightKg: 0.25, lengthCm: 30, widthCm: 20, heightCm: 5 },
  },
] as const;

const DEFAULT_PACKAGE = {
  weightKg: 0.5,
  lengthCm: 30,
  widthCm: 25,
  heightCm: 10,
};

const readBooleanEnv = (name: string, defaultValue: boolean): boolean => {
  const value = process.env[name]?.trim();
  if (!value) {
    return defaultValue;
  }
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
};

const allowDefaultDimensions = (): boolean =>
  readBooleanEnv("FEDEX_ALLOW_DEFAULT_PACKAGE_DIMENSIONS", false);

const getPackingStrategy = (): FedexPackingStrategy => {
  const value = process.env.FEDEX_PACKING_STRATEGY?.trim().toUpperCase();
  return value === "SIMPLE_CONSOLIDATED" ? "SIMPLE_CONSOLIDATED" : "PER_UNIT";
};

const toPositiveNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
};

const normalizeSearchText = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const safeObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};

const getNested = (source: Record<string, any>, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);

const hasDisabledShipping = (product: FedexProductPackageInput): boolean => {
  const raw = safeObject(product.rawProduct);
  const fedexShipping = safeObject(raw.fedexShipping);
  const shipping = safeObject(raw.shipping);

  return fedexShipping.enabled === false || shipping.requiresShipping === false;
};

const roundPackageDimensions = (
  values: Omit<FedexPackageDimensions, "packageType">,
): FedexPackageDimensions => ({
  weightKg: Number(values.weightKg.toFixed(2)),
  lengthCm: Math.ceil(values.lengthCm),
  widthCm: Math.ceil(values.widthCm),
  heightCm: Math.ceil(values.heightCm),
});

const assertFedexLimits = (
  productName: string,
  dimensions: FedexPackageDimensions,
): void => {
  const lengthPlusGirth =
    dimensions.lengthCm + 2 * dimensions.widthCm + 2 * dimensions.heightCm;

  if (
    dimensions.weightKg > MAX_WEIGHT_KG ||
    dimensions.lengthCm > MAX_LENGTH_CM ||
    lengthPlusGirth > MAX_LENGTH_PLUS_GIRTH_CM
  ) {
    throw new FedexPackageValidationError(
      `El producto "${productName}" excede los límites de tamaño/peso permitidos para FedEx`,
      FEDEX_PRODUCT_LIMITS_EXCEEDED,
    );
  }
};

const validateAndNormalize = (
  productName: string,
  values: {
    weightKg?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  },
): FedexPackageDimensions => {
  if (
    !values.weightKg ||
    !values.lengthCm ||
    !values.widthCm ||
    !values.heightCm
  ) {
    throw new FedexPackageValidationError(
      `El producto "${productName}" no tiene peso y dimensiones FedEx válidos`,
      FEDEX_PRODUCT_DIMENSIONS_MISSING,
    );
  }

  const dimensions = roundPackageDimensions({
    weightKg: values.weightKg,
    lengthCm: values.lengthCm,
    widthCm: values.widthCm,
    heightCm: values.heightCm,
  });

  assertFedexLimits(productName, dimensions);
  return dimensions;
};

const getDefaultDimensions = (
  product: FedexProductPackageInput,
): Omit<FedexPackageDimensions, "packageType"> => {
  const haystack = normalizeSearchText(
    [
      product.name,
      product.categoryId,
      product.rawProduct?.clave,
      product.rawProduct?.descripcion,
      product.rawProduct?.categoriaId,
      product.rawProduct?.lineaId,
    ].join(" "),
  );
  const matched = DEFAULT_PACKAGES.find((item) => item.matcher.test(haystack));
  return matched?.dimensions ?? DEFAULT_PACKAGE;
};

export const normalizeProductForFedex = (
  product: FedexProductPackageInput,
): FedexPackageDimensions => {
  if (hasDisabledShipping(product)) {
    throw new FedexPackageValidationError(
      `El producto "${product.name}" no requiere envío FedEx`,
      FEDEX_PRODUCT_DIMENSIONS_MISSING,
      400,
    );
  }

  const raw = safeObject(product.rawProduct);
  const fedexShipping = safeObject(raw.fedexShipping);
  const fedexDimensions = safeObject(
    fedexShipping.dimensions || fedexShipping.dimensiones,
  );
  const shipping = safeObject(raw.shipping);
  const shippingDimensions = safeObject(shipping.dimensions || shipping.dimensiones);
  const dimensions = safeObject(raw.dimensions || raw.dimensiones);

  const weightKg = toPositiveNumber(
    fedexShipping.weightKg,
    fedexShipping.pesoKg,
    shipping.weightKg,
    shipping.pesoKg,
    raw.weightKg,
    raw.weight,
    raw.pesoKg,
    raw.peso,
    getNested(raw, "logistics.weightKg"),
  );
  const lengthCm = toPositiveNumber(
    fedexShipping.lengthCm,
    fedexShipping.largoCm,
    fedexDimensions.lengthCm,
    fedexDimensions.largoCm,
    shipping.lengthCm,
    shipping.largoCm,
    shippingDimensions.lengthCm,
    shippingDimensions.largoCm,
    dimensions.lengthCm,
    dimensions.largoCm,
    raw.lengthCm,
    raw.length,
    raw.largoCm,
    raw.largo,
  );
  const widthCm = toPositiveNumber(
    fedexShipping.widthCm,
    fedexShipping.anchoCm,
    fedexDimensions.widthCm,
    fedexDimensions.anchoCm,
    shipping.widthCm,
    shipping.anchoCm,
    shippingDimensions.widthCm,
    shippingDimensions.anchoCm,
    dimensions.widthCm,
    dimensions.anchoCm,
    raw.widthCm,
    raw.width,
    raw.anchoCm,
    raw.ancho,
  );
  const heightCm = toPositiveNumber(
    fedexShipping.heightCm,
    fedexShipping.altoCm,
    fedexDimensions.heightCm,
    fedexDimensions.altoCm,
    shipping.heightCm,
    shipping.altoCm,
    shippingDimensions.heightCm,
    shippingDimensions.altoCm,
    dimensions.heightCm,
    dimensions.altoCm,
    raw.heightCm,
    raw.height,
    raw.altoCm,
    raw.alto,
  );

  if (weightKg && lengthCm && widthCm && heightCm) {
    return validateAndNormalize(product.name, {
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
    });
  }

  if (!allowDefaultDimensions()) {
    throw new FedexPackageValidationError(
      `El producto "${product.name}" no tiene peso y dimensiones FedEx válidos`,
      FEDEX_PRODUCT_DIMENSIONS_MISSING,
    );
  }

  console.warn(`Se usaron dimensiones default para ${product.name}`);
  return validateAndNormalize(product.name, getDefaultDimensions(product));
};

const toLineItem = (
  dimensions: FedexPackageDimensions,
  index: number,
  reference: string,
): FedexRequestedPackageLineItem => ({
  sequenceNumber: String(index + 1),
  weight: {
    units: "KG",
    value: dimensions.weightKg,
  },
  dimensions: {
    length: dimensions.lengthCm,
    width: dimensions.widthCm,
    height: dimensions.heightCm,
    units: "CM",
  },
  customerReferences: [
    {
      customerReferenceType: "CUSTOMER_REFERENCE",
      value: reference,
    },
  ],
});

const buildPerUnitPackages = (
  products: FedexProductPackageInput[],
): Array<{ dimensions: FedexPackageDimensions; reference: string }> => {
  const packages: Array<{ dimensions: FedexPackageDimensions; reference: string }> =
    [];

  for (const product of products) {
    if (hasDisabledShipping(product)) {
      continue;
    }

    const dimensions = normalizeProductForFedex(product);
    const quantity = Math.max(0, Math.floor(product.quantity));

    for (let index = 0; index < quantity; index += 1) {
      packages.push({
        dimensions,
        reference: `producto: ${product.name}`,
      });
    }
  }

  return packages;
};

const buildConsolidatedPackage = (
  products: FedexProductPackageInput[],
): Array<{ dimensions: FedexPackageDimensions; reference: string }> => {
  const normalized = products
    .filter((product) => !hasDisabledShipping(product))
    .map((product) => ({
      product,
      dimensions: normalizeProductForFedex(product),
    }));

  if (normalized.length === 0) {
    return [];
  }

  const consolidated = validateAndNormalize("carrito", {
    weightKg: normalized.reduce(
      (total, item) => total + item.dimensions.weightKg * item.product.quantity,
      0,
    ),
    lengthCm: Math.max(...normalized.map((item) => item.dimensions.lengthCm)),
    widthCm: Math.max(...normalized.map((item) => item.dimensions.widthCm)),
    heightCm: normalized.reduce(
      (total, item) => total + item.dimensions.heightCm * item.product.quantity,
      0,
    ),
  });

  if (consolidated.weightKg > 20) {
    return buildPerUnitPackages(products);
  }

  return [{ dimensions: consolidated, reference: "carrito" }];
};

export const buildFedexPackageLineItemsFromCart = (
  items: FedexProductPackageInput[],
  options: { strategy?: FedexPackingStrategy } = {},
): FedexCartPackageBuildResult => {
  const strategy = options.strategy || getPackingStrategy();
  const built =
    strategy === "SIMPLE_CONSOLIDATED"
      ? buildConsolidatedPackage(items)
      : buildPerUnitPackages(items);
  const packages = built.map((item) => item.dimensions);

  if (process.env.FEDEX_ENV === "sandbox") {
    console.log("fedex_packages_generated", {
      strategy,
      products: items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
      })),
      packages,
    });
  }

  return {
    requiresShipping: packages.length > 0,
    packages,
    requestedPackageLineItems: built.map((item, index) =>
      toLineItem(item.dimensions, index, item.reference),
    ),
    warnings: [],
  };
};
