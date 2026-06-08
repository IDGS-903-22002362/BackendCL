import { fedexClient } from "./fedex-client";
import { getFedexConfig } from "./fedex.config";
import { FedexRateQuoteInput } from "./fedex-rates.types";
import { normalizeMxStateForFedEx } from "./fedex-address.helper";

const FEDEX_AVAILABILITY_PATH = "/availability/v1/transittimes";

export class FedexAvailabilityService {
  constructor(private readonly client = fedexClient) {}

  async checkAvailability(input: FedexRateQuoteInput) {
    const config = getFedexConfig();

    const requestPayload = {
      accountNumber: {
        value: config.accountNumber,
      },
      origin: {
        postalCode: input.origin.postalCode,
        countryCode: input.origin.countryCode,
        ...(input.origin.stateOrProvinceCode ? { stateOrProvinceCode: normalizeMxStateForFedEx(input.origin.stateOrProvinceCode) } : {}),
        ...(input.origin.city ? { city: input.origin.city.replace(" de los Aldama", "") } : {}),
      },
      destination: {
        postalCode: input.destination.postalCode,
        countryCode: input.destination.countryCode,
        ...(input.destination.stateOrProvinceCode ? { stateOrProvinceCode: normalizeMxStateForFedEx(input.destination.stateOrProvinceCode) } : {}),
        ...(input.destination.city ? { city: input.destination.city.replace(" de los Aldama", "") } : {}),
      },
      shipDateStamp: input.shipDate,
      carrierCodes: ["FDXE", "FDXG"],
    };

    console.log("[FedEx Service Availability Payload]", JSON.stringify(requestPayload, null, 2));

    try {
      const response = await this.client.post<any>(
        FEDEX_AVAILABILITY_PATH,
        requestPayload,
      );

      const transitDays = response.output?.transitDays || [];
      const availableServices = transitDays.map((td: any) => ({
        serviceType: td.serviceType,
        serviceName: td.serviceName,
        packagingTypes: td.packagingTypes || [],
        carrierCode: td.carrierCode,
      }));

      // Filter: must support YOUR_PACKAGING, exclude FEDEX_ONE_RATE, FXSP
      const validOptions = availableServices.filter((srv: any) => {
        if (srv.serviceType === "FEDEX_ONE_RATE" || srv.serviceType === "SMART_POST" || srv.serviceType === "FEDEX_GROUND_ECONOMY") {
          return false;
        }
        if (srv.carrierCode === "FXSP") {
          return false;
        }
        // Validar si trae YOUR_PACKAGING
        return srv.packagingTypes.includes("YOUR_PACKAGING");
      });

      console.log("[FedEx Service Availability Valid Options]", validOptions);

      return validOptions;
    } catch (error: any) {
      console.error("[FedEx Error Raw]", {
        source: "SERVICE_AVAILABILITY",
        status: error?.originalError?.response?.status || error?.status,
        statusText: error?.originalError?.response?.statusText,
        transactionId:
          error?.originalError?.response?.headers?.["x-customer-transaction-id"] ||
          error?.originalError?.response?.headers?.["x-fedex-transaction-id"] ||
          error?.fedexTransactionId,
        data: error?.originalError?.response?.data,
        message: error?.message,
      });
      throw error;
    }
  }
}

export const fedexAvailabilityService = new FedexAvailabilityService();
