import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { Carrito } from "../../models/carrito.model";
import { DireccionEnvio } from "../../models/orden.model";
import { Producto } from "../../models/producto.model";
import { getFedexShipperConfig } from "./fedex/fedex-ship.mapper";
import {
  FedexRateAddressInput,
  FedexRateOption,
  FedexRatePackageInput,
  FedexRateQuoteInput,
} from "./fedex/fedex-rates.types";
import { fedexRatesService } from "./fedex/fedex-rates.service";

const SHIPPING_QUOTES_COLLECTION = "shipping_quotes";
const PRODUCTOS_COLLECTION = "productos";
const QUOTE_TTL_MS = 20 * 60 * 1000;

export class ShippingQuoteError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ShippingQuoteError";
    this.statusCode = statusCode;
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

export interface CreateCartFedexQuoteInput {
  userId: string;
  cart: Carrito;
  direccionEnvio: DireccionEnvio;
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

const readPositiveNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;

    if (Number.isFinite(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }

  return undefined;
};

const getNested = (source: Record<string, any>, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);

const packageFromProduct = (
  productId: string,
  product: Producto,
): FedexRatePackageInput => {
  const raw = product as Record<string, any>;
  const shipping = raw.shipping || {};
  const dimensions = raw.dimensions || raw.dimensiones || shipping.dimensions || {};

  const weightKg = readPositiveNumber(
    shipping.weightKg,
    shipping.pesoKg,
    raw.weightKg,
    raw.pesoKg,
    raw.peso,
    getNested(raw, "logistics.weightKg"),
  );
  const lengthCm = readPositiveNumber(
    dimensions.lengthCm,
    dimensions.largoCm,
    shipping.lengthCm,
    raw.lengthCm,
    raw.largoCm,
    raw.largo,
  );
  const widthCm = readPositiveNumber(
    dimensions.widthCm,
    dimensions.anchoCm,
    shipping.widthCm,
    raw.widthCm,
    raw.anchoCm,
    raw.ancho,
  );
  const heightCm = readPositiveNumber(
    dimensions.heightCm,
    dimensions.altoCm,
    shipping.heightCm,
    raw.heightCm,
    raw.altoCm,
    raw.alto,
  );

  if (!weightKg || !lengthCm || !widthCm || !heightCm) {
    throw new ShippingQuoteError(
      `El producto "${product.descripcion || productId}" no tiene peso y dimensiones FedEx válidos`,
      422,
    );
  }

  return { weightKg, lengthCm, widthCm, heightCm };
};

const buildDestination = (address: DireccionEnvio): FedexRateAddressInput => ({
  postalCode: address.codigoPostal,
  city: address.ciudad,
  stateOrProvinceCode: address.estado,
  countryCode: "MX",
  residential: true,
});

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

export class ShippingQuoteService {
  private getCollection() {
    return firestoreTienda.collection(SHIPPING_QUOTES_COLLECTION);
  }

  async buildPackagesFromCart(cart: Carrito): Promise<FedexRatePackageInput[]> {
    if (!Array.isArray(cart.items) || cart.items.length === 0) {
      throw new ShippingQuoteError("El carrito está vacío", 400);
    }

    const packages: FedexRatePackageInput[] = [];
    for (const item of cart.items) {
      const productDoc = await firestoreTienda
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
          `El producto "${product.descripcion}" no está disponible`,
          400,
        );
      }

      const productPackage = packageFromProduct(item.productoId, product);
      for (let index = 0; index < item.cantidad; index += 1) {
        packages.push(productPackage);
      }
    }

    if (packages.length > 99) {
      throw new ShippingQuoteError(
        "FedEx permite máximo 99 paquetes por cotización",
        422,
      );
    }

    return packages;
  }

  async createFedexCartQuote(input: CreateCartFedexQuoteInput) {
    const packages = await this.buildPackagesFromCart(input.cart);
    const cartHash = buildShippingCartHash(input.cart);
    const quoteInput: FedexRateQuoteInput = {
      origin: buildOrigin(),
      destination: buildDestination(input.direccionEnvio),
      packages,
      shipDate: new Date().toISOString().slice(0, 10),
      currency: "MXN",
      rateRequestTypes: ["ACCOUNT"],
    };

    const quote = await fedexRatesService.quoteRates(quoteInput);
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
      throw new ShippingQuoteError("La cotización FedEx no existe", 409);
    }

    const quote = {
      id: quoteDoc.id,
      ...(quoteDoc.data() as Omit<ShippingQuoteRecord, "id">),
    };

    if (quote.provider !== "FEDEX") {
      throw new ShippingQuoteError("La cotización no pertenece a FedEx", 409);
    }

    if (quote.userId !== input.userId) {
      throw new ShippingQuoteError("La cotización no pertenece al usuario", 403);
    }

    if (quote.expiresAt.toMillis() <= Date.now()) {
      throw new ShippingQuoteError("La cotización FedEx expiró", 409);
    }

    if (quote.cartHash !== buildShippingCartHash(input.cart)) {
      throw new ShippingQuoteError(
        "El carrito cambió desde la cotización FedEx",
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
        "La opción seleccionada no existe en la cotización FedEx",
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
