import {
  CheckoutFlowError,
  CheckoutItemPricingSnapshot,
  CheckoutShippingAddress,
  CheckoutShippingSelection,
  CheckoutShippingSnapshot,
} from "../../models/checkout-pricing.model";
import { Carrito } from "../../models/carrito.model";
import {
  FedexPublicRateError,
  fedexRatesService,
} from "../../modules/shipping/fedex/fedex-rates.service";
import {
  FedexServiceAvailabilityError,
  fedexServiceAvailabilityService,
} from "../../modules/shipping/fedex/fedex-service-availability.service";
import {
  FedexRatePackageDto,
  NormalizedFedexRateQuote,
} from "../../modules/shipping/fedex/fedex-rates.types";
import { shippingQuoteService } from "../../modules/shipping/shipping-quote.service";
import {
  calculateManualShippingCost,
  MANUAL_FEDEX_CARRIER,
  MANUAL_FEDEX_CURRENCY,
  MANUAL_FEDEX_METHOD,
  MANUAL_FEDEX_PROVIDER,
  MANUAL_FEDEX_STATUS,
  resolveManualShippingZone,
} from "../../config/manual-shipping.config";
import type {
  ShippingQuoteRecord,
  ShippingQuoteOption,
  ValidateSelectedQuoteInput,
} from "../../modules/shipping/shipping-quote.service";

type ShippingQuoteServiceLike = {
  validateSelectedQuote(
    input: ValidateSelectedQuoteInput,
  ): Promise<{
    quote: ShippingQuoteRecord;
    selectedOption: ShippingQuoteOption;
  }>;
};

type FedexRatesServiceLike = {
  quotePublicRates(input: {
    recipient: {
      streetLines?: string[];
      city?: string;
      stateOrProvinceCode?: string;
      postalCode: string;
      countryCode: string;
      residential?: boolean;
    };
    packages: FedexRatePackageDto[];
    shipDateStamp?: string;
    serviceType?: string;
    carrierCodes?: Array<"FDXE" | "FDXG" | "FXSP" | "FXCC">;
    returnTransitTimes?: boolean;
    preferredCurrency?: string;
    packagingType?: string;
  }): Promise<{
    success: true;
    transactionId?: string;
    currency: string;
    quotes: NormalizedFedexRateQuote[];
    alerts: Array<{ code?: string; message?: string; alertType?: string }>;
  }>;
};

type FedexAvailabilityServiceLike = {
  retrieveServicesAndTransitTimes(input: {
    recipient: {
      streetLines?: string[];
      city?: string;
      stateOrProvinceCode?: string;
      postalCode: string;
      countryCode: string;
      residential?: boolean;
    };
    packages: Array<{
      weightKg: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      declaredValue?: number;
      quantity?: number;
    }>;
    serviceType?: string;
    carrierCodes?: Array<"FDXE" | "FDXG" | "FXSP">;
    packagingType?: string;
    pickupType?: "CONTACT_FEDEX_TO_SCHEDULE" | "DROPOFF_AT_FEDEX_LOCATION" | "USE_SCHEDULED_PICKUP";
    preferredCurrency?: string;
  }): Promise<{
    success: true;
    transactionId?: string;
    services: Array<{
      serviceType: string;
      serviceName?: string;
      carrierCode?: string;
      packagingType?: string;
      transitTime?: string;
      deliveryDate?: string;
      deliveryDayOfWeek?: string;
      saturdayDelivery?: boolean;
    }>;
  }>;
};

export type CheckoutShippingInput = {
  userId?: string;
  cart?: Carrito;
  items: CheckoutItemPricingSnapshot[];
  shippingSelection: CheckoutShippingSelection;
  shippingAddress?: CheckoutShippingAddress;
  currency: string;
  shippingQuoteId?: string;
  selectedShippingOptionId?: string;
  selectedServiceType?: string;
};

const RATE_CHANGE_TOLERANCE = 1;

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const cleanText = (value?: string): string | undefined => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
};

const normalizeStreetLines = (streetLines?: string[]): string[] =>
  (streetLines || [])
    .map((value) => cleanText(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

const toCarrierCodes = (carrierCode?: string): Array<"FDXE" | "FDXG" | "FXSP" | "FXCC"> | undefined => {
  if (!carrierCode) {
    return undefined;
  }

  if (
    carrierCode === "FDXE" ||
    carrierCode === "FDXG" ||
    carrierCode === "FXSP" ||
    carrierCode === "FXCC"
  ) {
    return [carrierCode];
  }

  return undefined;
};

const toAvailabilityCarrierCodes = (
  carrierCode?: string,
): Array<"FDXE" | "FDXG" | "FXSP"> | undefined => {
  if (carrierCode === "FDXE" || carrierCode === "FDXG" || carrierCode === "FXSP") {
    return [carrierCode];
  }

  return undefined;
};

export class CheckoutShippingService {
  constructor(
    private readonly quoteService: ShippingQuoteServiceLike = shippingQuoteService,
    private readonly ratesService: FedexRatesServiceLike = fedexRatesService,
    private readonly availabilityService: FedexAvailabilityServiceLike =
      fedexServiceAvailabilityService,
  ) {}

  async calculateShipping(
    input: CheckoutShippingInput,
  ): Promise<CheckoutShippingSnapshot> {
    const method = input.shippingSelection.method;

    if (method === "PICKUP") {
      return {
        method: "PICKUP",
        amount: 0,
        currency: input.currency,
        quotedAt: new Date().toISOString(),
      };
    }

    if (method === "MANUAL") {
      const shippingAddress = this.requireShippingAddress(input.shippingAddress);
      const shippingZone = resolveManualShippingZone(
        shippingAddress.postalCode,
      );
      const shippingAmount = calculateManualShippingCost(
        shippingAddress.postalCode,
      );

      return {
        method: "MANUAL",
        provider: MANUAL_FEDEX_PROVIDER,
        carrier: MANUAL_FEDEX_CARRIER,
        shippingMethod: MANUAL_FEDEX_METHOD,
        serviceName: "FedEx manual",
        amount: shippingAmount,
        currency: MANUAL_FEDEX_CURRENCY || input.currency,
        address: shippingAddress,
        addressValidationStatus:
          shippingAddress.addressValidationStatus || "USER_CONFIRMED",
        status: MANUAL_FEDEX_STATUS,
        createdManually: true,
        shippingZone,
        quotedAt: new Date().toISOString(),
      };
    }

    return this.calculateFedexShipping(input);
  }

  private async calculateFedexShipping(
    input: CheckoutShippingInput,
  ): Promise<CheckoutShippingSnapshot> {
    const shippingAddress = this.requireShippingAddress(input.shippingAddress);
    const warnings: string[] = [];
    const quoteSelection = await this.resolveSelectionFromLegacyQuote(input);
    const selected = {
      ...quoteSelection,
      ...input.shippingSelection,
      method: "FEDEX" as const,
      provider: "FEDEX" as const,
    };

    const packages = this.buildFedexPackages(input.items);
    const rates = await this.quoteRates(packages, shippingAddress, selected);

    const selectedQuote = this.findSelectedQuote(rates.quotes, selected);
    if (!selectedQuote) {
      throw new CheckoutFlowError(
        "FEDEX_RATE_UNAVAILABLE",
        "FedEx no devolvio tarifas disponibles para esta direccion y paquetes.",
        422,
        {
          quotes: rates.quotes,
        },
      );
    }

    const quotedAmount =
      typeof selected.quotedAmount === "number"
        ? roundMoney(selected.quotedAmount)
        : undefined;
    const recalculatedAmount = roundMoney(selectedQuote.amount);

    if (
      typeof quotedAmount === "number" &&
      Math.abs(recalculatedAmount - quotedAmount) > RATE_CHANGE_TOLERANCE
    ) {
      throw new CheckoutFlowError(
        "SHIPPING_RATE_CHANGED",
        "El costo de envio cambio. Confirma nuevamente tu metodo de envio.",
        409,
        {
          quotes: rates.quotes,
        },
      );
    }

    const availability = await this.tryValidateAvailability(
      packages,
      shippingAddress,
      selected,
      warnings,
    );

    if (
      availability &&
      selectedQuote.serviceType &&
      !availability.services.some(
        (service) =>
          service.serviceType === selectedQuote.serviceType &&
          (!selected.carrierCode || !service.carrierCode || service.carrierCode === selected.carrierCode),
      )
    ) {
      throw new CheckoutFlowError(
        "FEDEX_SERVICE_NOT_AVAILABLE",
        "El servicio FedEx seleccionado ya no esta disponible para esta direccion.",
        409,
      );
    }

    const serviceAvailability = availability?.services.find(
      (service) => service.serviceType === selectedQuote.serviceType,
    );

    return {
      method: "FEDEX",
      provider: "FEDEX",
      serviceType: selectedQuote.serviceType,
      serviceName: selectedQuote.serviceName,
      carrierCode: selected.carrierCode || selectedQuote.carrierCode,
      packagingType: selectedQuote.packagingType || selected.packagingType,
      amount: recalculatedAmount,
      currency: selectedQuote.currency || rates.currency,
      transitTime: selectedQuote.transitTime || serviceAvailability?.transitTime,
      deliveryTimestamp:
        selectedQuote.deliveryTimestamp || serviceAvailability?.deliveryDate,
      deliveryDayOfWeek:
        selectedQuote.deliveryDayOfWeek || serviceAvailability?.deliveryDayOfWeek,
      address: shippingAddress,
      addressValidationStatus:
        shippingAddress.addressValidationStatus || "USER_CONFIRMED",
      rateTransactionId: rates.transactionId,
      availabilityTransactionId: availability?.transactionId,
      quotedAt: new Date().toISOString(),
      warnings,
      status: "QUOTE_SELECTED",
      quoteId: selected.quoteId,
      selectedOptionId: selected.selectedOptionId,
      selectedRate: {
        provider: "FEDEX",
        serviceType: selectedQuote.serviceType,
        serviceName: selectedQuote.serviceName,
        packagingType: selectedQuote.packagingType,
        amount: recalculatedAmount,
        currency: selectedQuote.currency || rates.currency,
        transitTime: selectedQuote.transitTime,
        deliveryTimestamp: selectedQuote.deliveryTimestamp,
        deliveryDayOfWeek: selectedQuote.deliveryDayOfWeek,
        carrierCode: selected.carrierCode || selectedQuote.carrierCode,
        rateType: selectedQuote.rateType,
      },
      packages: packages.map((item) => ({ ...item })),
      destination: {
        streetLines: shippingAddress.streetLines,
        city: shippingAddress.city,
        stateOrProvinceCode: shippingAddress.stateOrProvinceCode,
        postalCode: shippingAddress.postalCode,
        countryCode: shippingAddress.countryCode,
        residential: shippingAddress.residential,
      },
    };
  }

  private requireShippingAddress(
    address?: CheckoutShippingAddress,
  ): CheckoutShippingAddress {
    const streetLines = normalizeStreetLines(address?.streetLines);
    const postalCode = cleanText(address?.postalCode);
    const countryCode = cleanText(address?.countryCode)?.toUpperCase();
    const stateOrProvinceCode = cleanText(address?.stateOrProvinceCode)?.toUpperCase();

    if (!address || streetLines.length === 0 || !postalCode || !countryCode) {
      throw new CheckoutFlowError(
        "SHIPPING_ADDRESS_REQUIRED",
        "La direccion de envio es requerida para calcular FedEx.",
        400,
      );
    }

    if (["MX", "US", "CA"].includes(countryCode) && !stateOrProvinceCode) {
      throw new CheckoutFlowError(
        "SHIPPING_ADDRESS_REQUIRED",
        "El estado o provincia es requerido para calcular FedEx.",
        400,
      );
    }

    return {
      streetLines,
      city: cleanText(address.city),
      stateOrProvinceCode,
      postalCode,
      countryCode,
      residential: typeof address.residential === "boolean" ? address.residential : true,
      addressValidationStatus:
        address.addressValidationStatus || "USER_CONFIRMED",
    };
  }

  private buildFedexPackages(
    items: CheckoutItemPricingSnapshot[],
  ): FedexRatePackageDto[] {
    const packages = items
      .filter((item) => item.requiereEnvio !== false)
      .map((item) => {
        if (
          !item.weightKg ||
          !item.lengthCm ||
          !item.widthCm ||
          !item.heightCm
        ) {
          throw new CheckoutFlowError(
            "PRODUCT_SHIPPING_DATA_MISSING",
            "Uno o mas productos no tienen peso o dimensiones configuradas para calcular envio.",
            422,
            {
              productId: item.productId,
              tallaId: item.tallaId,
            },
          );
        }

        return {
          weightKg: item.weightKg,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          heightCm: item.heightCm,
          declaredValue: item.subtotalFinal > 0 ? roundMoney(item.subtotalFinal) : undefined,
          quantity: item.quantity,
        };
      });

    if (packages.length === 0) {
      throw new CheckoutFlowError(
        "FEDEX_RATE_UNAVAILABLE",
        "No hay productos fisicos para cotizar envio.",
        422,
      );
    }

    return packages;
  }

  private async quoteRates(
    packages: FedexRatePackageDto[],
    address: CheckoutShippingAddress,
    selection: CheckoutShippingSelection & {
      quoteId?: string;
      selectedOptionId?: string;
    },
  ) {
    try {
      return await this.ratesService.quotePublicRates({
        recipient: {
          streetLines: address.streetLines,
          city: address.city,
          stateOrProvinceCode: address.stateOrProvinceCode,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
          residential: address.residential,
        },
        packages,
        serviceType: selection.serviceType,
        carrierCodes: toCarrierCodes(selection.carrierCode),
        returnTransitTimes: true,
        preferredCurrency: selection.quotedCurrency,
        packagingType: selection.packagingType,
      });
    } catch (error) {
      if (error instanceof FedexPublicRateError) {
        throw new CheckoutFlowError(
          error.code === "FEDEX_RATE_UNAVAILABLE"
            ? "FEDEX_RATE_UNAVAILABLE"
            : "FEDEX_RATE_UNAVAILABLE",
          error.message,
          error.statusCode,
        );
      }

      throw error;
    }
  }

  private findSelectedQuote(
    quotes: NormalizedFedexRateQuote[],
    selection: CheckoutShippingSelection,
  ): NormalizedFedexRateQuote | undefined {
    if (quotes.length === 0) {
      return undefined;
    }

    const filteredByService = selection.serviceType
      ? quotes.filter((quote) => quote.serviceType === selection.serviceType)
      : quotes;

    const filteredByCarrier =
      selection.carrierCode && filteredByService.some((quote) => quote.carrierCode)
        ? filteredByService.filter(
            (quote) => !quote.carrierCode || quote.carrierCode === selection.carrierCode,
          )
        : filteredByService;

    const filteredByPackaging =
      selection.packagingType && filteredByCarrier.some((quote) => quote.packagingType)
        ? filteredByCarrier.filter(
            (quote) =>
              !quote.packagingType || quote.packagingType === selection.packagingType,
          )
        : filteredByCarrier;

    return filteredByPackaging[0] || filteredByCarrier[0] || filteredByService[0] || quotes[0];
  }

  private async resolveSelectionFromLegacyQuote(input: CheckoutShippingInput) {
    if (!input.shippingQuoteId || !input.userId || !input.cart) {
      return {};
    }

    const { quote, selectedOption } = await this.quoteService.validateSelectedQuote({
      userId: input.userId,
      cart: input.cart,
      shippingQuoteId: input.shippingQuoteId,
      selectedOptionId: input.selectedShippingOptionId,
      selectedServiceType: input.selectedServiceType,
    });

    return {
      provider: "FEDEX" as const,
      serviceType: selectedOption.serviceType,
      serviceName: selectedOption.serviceName,
      packagingType: selectedOption.packagingType,
      quotedAmount: selectedOption.amount,
      quotedCurrency: selectedOption.currency,
      transitTime: selectedOption.transitTime,
      deliveryTimestamp: selectedOption.estimatedDeliveryDate,
      quoteId: input.shippingQuoteId,
      selectedOptionId: selectedOption.optionId,
      packages: quote.packages,
      destination: quote.destination,
    };
  }

  private async tryValidateAvailability(
    packages: FedexRatePackageDto[],
    address: CheckoutShippingAddress,
    selection: CheckoutShippingSelection,
    warnings: string[],
  ) {
    if (!selection.serviceType) {
      return undefined;
    }

    try {
      return await this.availabilityService.retrieveServicesAndTransitTimes({
        recipient: {
          streetLines: address.streetLines,
          city: address.city,
          stateOrProvinceCode: address.stateOrProvinceCode,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
          residential: address.residential,
        },
        packages: packages.map((item) => ({
          weightKg: item.weightKg,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          heightCm: item.heightCm,
          declaredValue: item.declaredValue,
          quantity: item.quantity,
        })),
        serviceType: selection.serviceType,
        carrierCodes: toAvailabilityCarrierCodes(selection.carrierCode),
        packagingType: selection.packagingType,
        pickupType: "DROPOFF_AT_FEDEX_LOCATION",
        preferredCurrency: selection.quotedCurrency,
      });
    } catch (error) {
      if (error instanceof FedexServiceAvailabilityError) {
        warnings.push(error.message);
        return undefined;
      }

      throw error;
    }
  }
}

export const checkoutShippingService = new CheckoutShippingService();
export default checkoutShippingService;
