import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { Carrito, ItemCarrito } from "../../models/carrito.model";
import { DireccionEnvio } from "../../models/orden.model";
import { Producto } from "../../models/producto.model";
import { getFedexShipperConfig } from "./fedex/fedex-ship.mapper";
import {
  FedexRateAddressInput,
  FedexRateOption,
  FedexRatePackageInput,
  FedexRateQuoteInput,
} from "./fedex/fedex-rates.types";
import { FedexProviderError } from "./fedex/fedex.errors";
import {
  FedexRateRequestConfigError,
  normalizeMxPhoneForFedEx,
} from "./fedex/fedex-rates.mapper";
import {
  FedexRatesUnavailableError,
  fedexRatesService,
} from "./fedex/fedex-rates.service";
import {
  FEDEX_PRODUCT_DIMENSIONS_MISSING,
  buildFedexPackageLineItemsFromCart,
  FedexProductPackageInput,
  FedexPackageValidationError,
} from "./fedex/fedex-package-normalizer";
import { normalizeMxStateForFedEx } from "./fedex/fedex-address.helper";
import {
  completeInventarioPorTalla,
  normalizeTallaIds,
} from "../../utils/size-inventory.util";

const SHIPPING_QUOTES_COLLECTION = "shipping_quotes";
const PRODUCTOS_COLLECTION = "productos";
const QUOTE_TTL_MS = 20 * 60 * 1000;
const PRODUCT_SHIPPING_DATA_MISSING = "PRODUCT_SHIPPING_DATA_MISSING";

export class ShippingQuoteError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = "ShippingQuoteError";
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export type ShippingQuoteOption = FedexRateOption & {
  optionId: string;
};

export interface ShippingQuoteRecord {
  id?: string;
  provider: "FEDEX";
  userId: string;
  cartId: string;
  cartHash: string;
  destination: FedexRateAddressInput;
  packages: FedexRatePackageInput[];
  options: ShippingQuoteOption[];
  currency: string;
  selectedOptionId?: string;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

type FirestoreLike = FirebaseFirestore.Firestore;

type FedexRatesServiceLike = {
  quoteRates(input: FedexRateQuoteInput): Promise<{
    ok: true;
    provider: "FEDEX";
    environment: "sandbox" | "production";
    quoteId: string;
    currency: string;
    options: FedexRateOption[];
  }>;
};

export type CartFedexAddressInput = {
  streetLines?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode?: string;
  residential?: boolean;
  [key: string]: unknown;
};

export type CartFedexDireccionEnvio = DireccionEnvio & {
  stateOrProvinceCode?: string;
  countryCode?: string;
  postalCode?: string;
};

export interface CreateCartFedexQuoteInput {
  userId: string;
  cart: Carrito;
  direccionEnvio?: CartFedexDireccionEnvio;
  shippingAddress?: CartFedexAddressInput;
  fedexAddress?: CartFedexAddressInput;
}

export interface ValidateSelectedQuoteInput {
  userId: string;
  cart: Carrito;
  shippingQuoteId: string;
  selectedServiceType?: string;
  selectedOptionId?: string;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const hashObject = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const normalizeCartForHash = (cart: Carrito) => ({
  items: [...(cart.items || [])]
    .map((item) => ({
      productoId: item.productoId,
      tallaId: item.tallaId || "",
      cantidad: item.cantidad,
      precioUnitario: roundMoney(item.precioUnitario),
    }))
    .sort((left, right) =>
      `${left.productoId}:${left.tallaId}`.localeCompare(
        `${right.productoId}:${right.tallaId}`,
      ),
    ),
});

export const buildShippingCartHash = (cart: Carrito): string =>
  hashObject(normalizeCartForHash(cart));

const cleanText = (value?: string | null): string | undefined => {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
};

const cleanStreetLines = (streetLines: Array<string | undefined>): string[] =>
  streetLines
    .map(cleanText)
    .filter((value): value is string => Boolean(value));

const buildStreetLinesFromDireccion = (
  address?: CartFedexDireccionEnvio,
): string[] =>
  address
    ? cleanStreetLines([
        `${address.calle} ${address.numero}`,
        address.numeroInterior
          ? `${address.colonia} Int ${address.numeroInterior}`
          : address.colonia,
      ])
    : [];

const pickText = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return undefined;
};

const normalizeCountryCode = (
  fedexAddress?: CartFedexAddressInput,
  shippingAddress?: CartFedexAddressInput,
  direccionEnvio?: CartFedexDireccionEnvio,
): string =>
  (pickText(
    fedexAddress?.countryCode,
    shippingAddress?.countryCode,
    direccionEnvio?.countryCode,
  ) || "MX").toUpperCase();

const normalizeStateCode = (
  countryCode: string,
  fedexAddress?: CartFedexAddressInput,
  shippingAddress?: CartFedexAddressInput,
  direccionEnvio?: CartFedexDireccionEnvio,
): string | undefined => {
  const explicitState = pickText(
    fedexAddress?.stateOrProvinceCode,
    shippingAddress?.stateOrProvinceCode,
    direccionEnvio?.stateOrProvinceCode,
  );

  const rawState = explicitState || cleanText(direccionEnvio?.estado);
  if (!rawState) {
    return undefined;
  }

  return countryCode === "MX"
    ? normalizeMxStateForFedEx(rawState)?.toUpperCase()
    : rawState.toUpperCase();
};

const buildDestinationFromCartPayload = (
  input: Pick<
    CreateCartFedexQuoteInput,
    "direccionEnvio" | "shippingAddress" | "fedexAddress"
  >,
): FedexRateAddressInput => {
  const { direccionEnvio, shippingAddress, fedexAddress } = input;
  const countryCode = normalizeCountryCode(
    fedexAddress,
    shippingAddress,
    direccionEnvio,
  );
  const stateOrProvinceCode = normalizeStateCode(
    countryCode,
    fedexAddress,
    shippingAddress,
    direccionEnvio,
  );
  const postalCode = pickText(
    fedexAddress?.postalCode,
    shippingAddress?.postalCode,
    direccionEnvio?.codigoPostal,
    direccionEnvio?.postalCode,
  );
  const streetLines = cleanStreetLines([
    ...(fedexAddress?.streetLines || []),
    ...(shippingAddress?.streetLines || []),
    ...buildStreetLinesFromDireccion(direccionEnvio),
  ]).slice(0, 3);
  const city = pickText(
    fedexAddress?.city,
    shippingAddress?.city,
    direccionEnvio?.ciudad,
  );

  if (!postalCode || !countryCode || streetLines.length === 0) {
    throw new ShippingQuoteError(
      "La direccion de envio es requerida para calcular FedEx.",
      400,
      "SHIPPING_ADDRESS_REQUIRED",
    );
  }

  if (["MX", "US", "CA"].includes(countryCode) && !stateOrProvinceCode) {
    throw new ShippingQuoteError(
      "El estado o provincia es requerido para calcular FedEx.",
      400,
      "SHIPPING_ADDRESS_REQUIRED",
    );
  }

  return {
    postalCode,
    city,
    stateOrProvinceCode,
    countryCode,
    residential:
      typeof fedexAddress?.residential === "boolean"
        ? fedexAddress.residential
        : typeof shippingAddress?.residential === "boolean"
          ? shippingAddress.residential
          : true,
    streetLines,
    contact: {
      personName: cleanText(direccionEnvio?.nombre),
      phoneNumber: normalizeMxPhoneForFedEx(direccionEnvio?.telefono),
    },
  };
};

const buildOrigin = (): FedexRateAddressInput => {
  const shipper = getFedexShipperConfig();
  return {
    postalCode: shipper.postalCode,
    city: shipper.city,
    stateOrProvinceCode: shipper.stateOrProvinceCode,
    countryCode: shipper.countryCode,
    residential: false,
  };
};

const buildOptionId = (option: FedexRateOption): string =>
  createHash("sha256")
    .update(
      [
        option.serviceType,
        option.packagingType,
        option.amount,
        option.currency,
        option.estimatedDeliveryDate || "",
        option.transitTime || "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);

const resolveAvailableStock = (product: Producto, item: ItemCarrito): number => {
  const tallaIds = normalizeTallaIds(product.tallaIds);

  if (tallaIds.length === 0) {
    return Math.max(0, Math.floor(Number(product.existencias ?? 0)));
  }

  const tallaId = item.tallaId?.trim();
  if (!tallaId || !tallaIds.includes(tallaId)) {
    return 0;
  }

  const inventory = completeInventarioPorTalla(
    tallaIds,
    product.inventarioPorTalla,
  );

  return inventory.find((entry) => entry.tallaId === tallaId)?.cantidad ?? 0;
};

const requiresPhysicalShipping = (product: Producto): boolean =>
  product.fedexShipping?.enabled !== false &&
  product.shipping?.requiresShipping !== false;

const mapFedexRateError = (
  error: FedexProviderError,
): { code: string; message: string; statusCode: number } => {
  switch (error.status) {
    case 401:
      return {
        code: "FEDEX_AUTH_FAILED",
        message: "No se pudo autenticar con FedEx.",
        statusCode: 401,
      };
    case 422:
      return {
        code: "FEDEX_RATE_UNPROCESSABLE",
        message:
          "FedEx no pudo procesar la cotizacion con la direccion o paquetes enviados.",
        statusCode: 422,
      };
    case 429:
      return {
        code: "FEDEX_RATE_LIMITED",
        message: "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
        statusCode: 429,
      };
    case 500:
    case 503:
      return {
        code: "FEDEX_SERVICE_UNAVAILABLE",
        message: "FedEx no esta disponible temporalmente.",
        statusCode: error.status,
      };
    default:
      return {
        code: error.status === 400 ? "FEDEX_RATE_UNPROCESSABLE" : "FEDEX_SERVICE_UNAVAILABLE",
        message: error.message || "FedEx no esta disponible temporalmente.",
        statusCode: error.status === 400 ? 422 : 503,
      };
  }
};

export class ShippingQuoteService {
  constructor(
    private readonly db: FirestoreLike = firestoreTienda as FirestoreLike,
    private readonly ratesService: FedexRatesServiceLike = fedexRatesService,
  ) {}

  private getCollection() {
    return this.db.collection(SHIPPING_QUOTES_COLLECTION);
  }

  async buildPackagesFromCart(cart: Carrito): Promise<FedexRatePackageInput[]> {
    if (!Array.isArray(cart.items) || cart.items.length === 0) {
      throw new ShippingQuoteError("El carrito estÃ¡ vacÃ­o", 400);
    }

    const products: FedexProductPackageInput[] = [];
    for (const item of cart.items) {
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        throw new ShippingQuoteError(
          `La cantidad del producto "${item.productoId}" debe ser mayor a 0`,
          400,
        );
      }

      const productDoc = await this.db
        .collection(PRODUCTOS_COLLECTION)
        .doc(item.productoId)
        .get();

      if (!productDoc.exists) {
        throw new ShippingQuoteError(
          `El producto con ID "${item.productoId}" no existe`,
          400,
        );
      }

      const product = productDoc.data() as Producto;
      if (!product.activo) {
        throw new ShippingQuoteError(
          `El producto "${product.descripcion}" no estÃ¡ disponible`,
          400,
        );
      }

      const availableStock = requiresPhysicalShipping(product)
        ? resolveAvailableStock(product, item)
        : item.cantidad;
      if (availableStock < item.cantidad) {
        throw new ShippingQuoteError(
          `No hay stock suficiente para "${product.descripcion}"`,
          409,
        );
      }

      products.push({
        productId: item.productoId,
        name: product.descripcion || item.productoId,
        quantity: item.cantidad,
        price: item.precioUnitario,
        categoryId: product.categoriaId,
        rawProduct: product,
      });
    }

    let packages: FedexRatePackageInput[];
    try {
      const result = buildFedexPackageLineItemsFromCart(products);
      packages = result.packages.map((item) => ({
        weightKg: item.weightKg,
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        ...(typeof item.declaredValue === "number" && item.declaredValue > 0
          ? { declaredValue: item.declaredValue }
          : {}),
      }));
    } catch (error) {
      if (error instanceof FedexPackageValidationError) {
        throw new ShippingQuoteError(
          error.message,
          error.statusCode,
          error.code === FEDEX_PRODUCT_DIMENSIONS_MISSING
            ? PRODUCT_SHIPPING_DATA_MISSING
            : error.code,
        );
      }
      throw error;
    }

    if (packages.length > 99) {
      throw new ShippingQuoteError(
        "FedEx permite mÃ¡ximo 99 paquetes por cotizaciÃ³n",
        422,
      );
    }

    return packages;
  }

  async createFedexCartQuote(input: CreateCartFedexQuoteInput) {
    const packages = await this.buildPackagesFromCart(input.cart);
    if (packages.length === 0) {
      return {
        ok: true,
        provider: "FEDEX" as const,
        requiresShipping: false,
        quoteId: "",
        currency: "MXN",
        expiresAt: undefined,
        options: [],
      };
    }

    const cartHash = buildShippingCartHash(input.cart);
    const shipDate = new Date().toISOString().slice(0, 10);
    const destination = buildDestinationFromCartPayload(input);

    const quoteInput: FedexRateQuoteInput = {
      origin: buildOrigin(),
      destination,
      packages,
      shipDate,
      currency: "MXN",
      rateRequestTypes: ["ACCOUNT", "LIST"],
      useConfiguredServiceType: false,
    };

    console.log("[FedEx Cart Quote Debug]", JSON.stringify({
      originalAddress: {
        direccionEnvio: input.direccionEnvio
          ? {
              calle: input.direccionEnvio.calle,
              numero: input.direccionEnvio.numero,
              numeroInterior: input.direccionEnvio.numeroInterior,
              colonia: input.direccionEnvio.colonia,
              ciudad: input.direccionEnvio.ciudad,
              estado: input.direccionEnvio.estado,
              stateOrProvinceCode: input.direccionEnvio.stateOrProvinceCode,
              codigoPostal: input.direccionEnvio.codigoPostal,
              postalCode: input.direccionEnvio.postalCode,
              countryCode: input.direccionEnvio.countryCode,
            }
          : null,
        shippingAddress: input.shippingAddress || null,
        fedexAddress: input.fedexAddress || null,
      },
      normalizedAddress: destination,
      finalStateOrProvinceCode: destination.stateOrProvinceCode,
      recipientAddress: {
        streetLines: destination.streetLines,
        city: destination.city,
        stateOrProvinceCode: destination.stateOrProvinceCode,
        postalCode: destination.postalCode,
        countryCode: destination.countryCode,
        residential: destination.residential,
      },
      packages,
      totalPackageCount: packages.length,
      totalWeight: packages.reduce((sum, item) => sum + item.weightKg, 0),
      ratePayloadInput: {
        origin: quoteInput.origin,
        destination: quoteInput.destination,
        packages: quoteInput.packages,
        shipDate: quoteInput.shipDate,
        currency: quoteInput.currency,
        rateRequestTypes: quoteInput.rateRequestTypes,
      },
    }, null, 2));

    let quote: Awaited<ReturnType<FedexRatesServiceLike["quoteRates"]>>;
    try {
      quote = await this.ratesService.quoteRates(quoteInput);
    } catch (error) {
      if (error instanceof FedexProviderError) {
        const mapped = mapFedexRateError(error);
        console.error("[FedEx Cart Quote Provider Error]", {
          status: error.status,
          code: mapped.code,
          message: mapped.message,
          fedexCode: (error as any).fedexCode,
          fedexMessage: error.message,
          transactionId: error.fedexTransactionId,
          recipientAddress: quoteInput.destination,
          packages,
          totalPackageCount: packages.length,
          totalWeight: packages.reduce((sum, item) => sum + item.weightKg, 0),
        });
        throw new ShippingQuoteError(
          mapped.message,
          mapped.statusCode,
          mapped.code,
        );
      }

      if (error instanceof FedexRatesUnavailableError) {
        throw new ShippingQuoteError(
          "FedEx no devolvio tarifas disponibles para esta direccion y paquetes.",
          error.statusCode,
          "FEDEX_RATE_UNAVAILABLE",
        );
      }

      if (error instanceof FedexRateRequestConfigError) {
        throw new ShippingQuoteError(
          error.message,
          error.statusCode,
          "FEDEX_RATE_UNPROCESSABLE",
        );
      }

      throw error;
    }
    const options: ShippingQuoteOption[] = quote.options.map((option) => ({
      ...option,
      optionId: option.optionId || buildOptionId(option),
    }));

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(Date.now() + QUOTE_TTL_MS);
    const record: Omit<ShippingQuoteRecord, "id"> = {
      provider: "FEDEX",
      userId: input.userId,
      cartId: input.cart.id || "",
      cartHash,
      destination: quoteInput.destination,
      packages,
      options,
      currency: quote.currency,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.getCollection().doc(quote.quoteId).set(record);

    return {
      ok: true,
      provider: "FEDEX" as const,
      requiresShipping: true,
      quoteId: quote.quoteId,
      currency: quote.currency,
      expiresAt: expiresAt.toDate().toISOString(),
      options,
    };
  }

  async validateSelectedQuote(
    input: ValidateSelectedQuoteInput,
  ): Promise<{ quote: ShippingQuoteRecord; selectedOption: ShippingQuoteOption }> {
    const quoteDoc = await this.getCollection().doc(input.shippingQuoteId).get();
    if (!quoteDoc.exists) {
      throw new ShippingQuoteError("La cotizaciÃ³n FedEx no existe", 409);
    }

    const quote = {
      id: quoteDoc.id,
      ...(quoteDoc.data() as Omit<ShippingQuoteRecord, "id">),
    };

    if (quote.provider !== "FEDEX") {
      throw new ShippingQuoteError("La cotizaciÃ³n no pertenece a FedEx", 409);
    }

    if (quote.userId !== input.userId) {
      throw new ShippingQuoteError("La cotizaciÃ³n no pertenece al usuario", 403);
    }

    if (quote.expiresAt.toMillis() <= Date.now()) {
      throw new ShippingQuoteError("La cotizaciÃ³n FedEx expirÃ³", 409);
    }

    if (quote.cartHash !== buildShippingCartHash(input.cart)) {
      throw new ShippingQuoteError(
        "El carrito cambiÃ³ desde la cotizaciÃ³n FedEx",
        409,
      );
    }

    const selectedOption = quote.options.find((option) => {
      if (input.selectedOptionId) {
        return option.optionId === input.selectedOptionId;
      }
      return option.serviceType === input.selectedServiceType;
    });

    if (!selectedOption) {
      throw new ShippingQuoteError(
        "La opciÃ³n seleccionada no existe en la cotizaciÃ³n FedEx",
        409,
      );
    }

    await quoteDoc.ref.set(
      {
        selectedOptionId: selectedOption.optionId,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    return { quote, selectedOption };
  }
}

export const shippingQuoteService = new ShippingQuoteService();

