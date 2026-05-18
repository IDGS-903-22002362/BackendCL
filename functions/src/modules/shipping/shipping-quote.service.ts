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
import { FedexProviderError } from "./fedex/fedex.errors";
import { FedexRateRequestConfigError } from "./fedex/fedex-rates.mapper";
import { fedexRatesService } from "./fedex/fedex-rates.service";
import { fedexAvailabilityService } from "./fedex/fedex-availability.service";
import {
  buildFedexPackageLineItemsFromCart,
  FedexProductPackageInput,
  FedexPackageValidationError,
} from "./fedex/fedex-package-normalizer";
import { fedexAddressService } from "./fedex/fedex-address.service";

const SHIPPING_QUOTES_COLLECTION = "shipping_quotes";
const PRODUCTOS_COLLECTION = "productos";
const QUOTE_TTL_MS = 20 * 60 * 1000;

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
      }));
    } catch (error) {
      if (error instanceof FedexPackageValidationError) {
        throw new ShippingQuoteError(
          error.message,
          error.statusCode,
          error.code,
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
    const quoteInput: FedexRateQuoteInput = {
      origin: buildOrigin(),
      destination: buildDestination(input.direccionEnvio),
      packages,
      shipDate: new Date().toISOString().slice(0, 10),
      currency: "MXN",
      rateRequestTypes: ["ACCOUNT", "LIST"],
    };

    const [isOriginValid, isDestinationValid] = await Promise.all([
      fedexAddressService.validatePostalCode({
        countryCode: quoteInput.origin.countryCode,
        stateOrProvinceCode: quoteInput.origin.stateOrProvinceCode,
        postalCode: quoteInput.origin.postalCode,
        carrierCode: "FDXE"
      }),
      fedexAddressService.validatePostalCode({
        countryCode: quoteInput.destination.countryCode,
        stateOrProvinceCode: quoteInput.destination.stateOrProvinceCode,
        postalCode: quoteInput.destination.postalCode,
        carrierCode: "FDXE"
      })
    ]);

    if (!isOriginValid || !isDestinationValid) {
      throw new ShippingQuoteError("FedEx no reconoce la combinación estado/código postal del origen o destino.", 422);
    }

    let quote: Awaited<ReturnType<FedexRatesServiceLike["quoteRates"]>>;
    try {
      // Caso A: Sin serviceType, sin carrierCodes
      quote = await this.ratesService.quoteRates(quoteInput);
    } catch (errorA) {
      console.warn("[FedEx Quote] Caso A falló, intentando Caso B con FDXE...");
      const quoteInputB = { ...quoteInput, carrierCodes: ["FDXE"] };
      
      try {
        // Caso B: Sin serviceType, carrier FDXE
        quote = await this.ratesService.quoteRates(quoteInputB);
      } catch (errorB) {
        console.warn("[FedEx Quote] Caso B falló, consultando Service Availability para Caso C...");
        
        try {
          const validOptions = await fedexAvailabilityService.checkAvailability(quoteInput);
          
          if (!validOptions || validOptions.length === 0) {
             throw new ShippingQuoteError(
               "El destino o cuenta no tiene cobertura válida con YOUR_PACKAGING según Service Availability API. Verifica origen/destino.",
               422
             );
          }
          
          const preferred = validOptions.find((o: any) => o.carrierCode === "FDXE") || validOptions[0];
          console.log(`[FedEx Quote] Caso C usando: serviceType=${preferred.serviceType}, carrierCode=${preferred.carrierCode}`);
          
          const quoteInputC = {
            ...quoteInput,
            serviceType: preferred.serviceType,
            carrierCodes: preferred.carrierCode ? [preferred.carrierCode] : undefined,
          };
          
          quote = await this.ratesService.quoteRates(quoteInputC);
        } catch (errorC) {
          console.error("[FedEx Quote] Todos los casos fallaron.");
          
          if (errorC instanceof ShippingQuoteError) {
            throw errorC; // Lanzado por nosotros mismos (0 combinaciones)
          }

          const finalError = errorC instanceof Error ? errorC : errorA;

          if (finalError instanceof FedexProviderError) {
            throw new ShippingQuoteError(finalError.message, 422);
          }

          if (finalError instanceof FedexRateRequestConfigError) {
            throw new ShippingQuoteError(finalError.message, finalError.statusCode);
          }

          throw finalError;
        }
      }
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

