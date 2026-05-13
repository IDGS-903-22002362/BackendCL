import {
  FedexTrackDirectInput,
  FedexTrackEvent,
  FedexTrackLocation,
  FedexTrackResponse,
  FedexTrackResultDetail,
  FedexTrackingResult,
  FedexTrackingStatus,
} from "./fedex-track.types";

export const fedexTrackingStatusLabels: Record<FedexTrackingStatus, string> = {
  LABEL_CREATED: "Guía creada",
  IN_TRANSIT: "En tránsito",
  OUT_FOR_DELIVERY: "En reparto",
  DELIVERED: "Entregado",
  EXCEPTION: "Incidencia",
  UNKNOWN: "Estado desconocido",
};

export const mapFedexTrackRequest = (input: FedexTrackDirectInput) => ({
  includeDetailedScans: input.includeDetailedScans,
  trackingInfo: input.trackingNumbers.map((trackingNumber) => ({
    trackingNumberInfo: {
      trackingNumber,
    },
  })),
});

const parseDateTime = (value: string | undefined): {
  date?: string;
  time?: string;
  timestamp?: string;
} => {
  if (!value) {
    return {};
  }

  const [datePart, timePartWithZone] = value.split("T");
  const timePart = timePartWithZone?.slice(0, 8);

  return {
    date: datePart || undefined,
    time: timePart || undefined,
    timestamp: value,
  };
};

const normalizeLocation = (
  location: FedexTrackLocation | undefined,
): FedexTrackLocation | undefined => {
  if (!location) {
    return undefined;
  }

  const normalized = {
    ...(location.city ? { city: location.city } : {}),
    ...(location.stateOrProvinceCode
      ? { stateOrProvinceCode: location.stateOrProvinceCode }
      : {}),
    ...(location.countryCode ? { countryCode: location.countryCode } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const statusFromFedex = (
  code: string | undefined,
  description: string | undefined,
): FedexTrackingStatus => {
  const normalizedCode = (code || "").toUpperCase();
  const normalizedDescription = (description || "").toUpperCase();
  const value = `${normalizedCode} ${normalizedDescription}`;

  if (["DL"].includes(normalizedCode) || /DELIVERED|DELIVERY COMPLETED/.test(value)) {
    return "DELIVERED";
  }

  if (["OD"].includes(normalizedCode) || /OUT FOR DELIVERY|ON VEHICLE/.test(value)) {
    return "OUT_FOR_DELIVERY";
  }

  if (
    ["OC"].includes(normalizedCode) ||
    /LABEL|SHIPMENT INFORMATION|INITIATED|INFORMATION SENT/.test(value)
  ) {
    return "LABEL_CREATED";
  }

  if (
    ["SE", "CA"].includes(normalizedCode) ||
    /EXCEPTION|DELAY|FAILED|ATTEMPT|HELD|CLEARANCE/.test(value)
  ) {
    return "EXCEPTION";
  }

  if (
    ["PU", "IT", "AR", "DP"].includes(normalizedCode) ||
    /TRANSIT|IN TRANSIT|ARRIVED|DEPARTED|PICKED UP/.test(value)
  ) {
    return "IN_TRANSIT";
  }

  return "UNKNOWN";
};

const getDateTimeByType = (
  detail: FedexTrackResultDetail,
  types: string[],
): string | undefined => {
  const normalizedTypes = types.map((item) => item.toUpperCase());
  return detail.dateAndTimes?.find((item) =>
    normalizedTypes.includes(String(item.type || "").toUpperCase()),
  )?.dateTime;
};

const getEstimatedDeliveryDate = (
  detail: FedexTrackResultDetail,
): string | undefined => {
  const direct = getDateTimeByType(detail, [
    "ESTIMATED_DELIVERY",
    "ACTUAL_DELIVERY",
    "COMMITMENT",
  ]);
  const windowEnd = detail.estimatedDeliveryTimeWindow?.window?.ends;
  const date = direct || windowEnd;

  return date ? date.slice(0, 10) : undefined;
};

const mapEvents = (detail: FedexTrackResultDetail): FedexTrackEvent[] =>
  (detail.scanEvents || []).map((event) => ({
    ...parseDateTime(event.date),
    eventType: event.eventType,
    eventDescription: event.eventDescription,
    ...(normalizeLocation(event.scanLocation)
      ? { location: normalizeLocation(event.scanLocation) }
      : {}),
  }));

const getLastEvent = (events: FedexTrackEvent[]): FedexTrackEvent | undefined =>
  events.find((event) => event.timestamp) || events[0];

const alertToMessage = (alert: { code?: string; message?: string }): string | undefined =>
  alert.message || alert.code;

const labelCreatedResult = (
  trackingNumber: string,
  warnings: string[],
  orderId?: string,
): FedexTrackingResult => ({
  ok: true,
  provider: "FEDEX",
  ...(orderId ? { orderId } : {}),
  trackingNumber,
  status: "LABEL_CREATED",
  statusLabel: fedexTrackingStatusLabels.LABEL_CREATED,
  statusDescription: "FedEx aún no tiene eventos de rastreo disponibles",
  deliveredAt: null,
  events: [],
  warnings,
  message: "FedEx aún no tiene eventos de rastreo disponibles para esta guía",
});

export const mapFedexTrackResponse = (
  trackingNumber: string,
  response: FedexTrackResponse,
  orderId?: string,
): FedexTrackingResult => {
  const warnings = (response.output?.alerts || [])
    .map(alertToMessage)
    .filter((item): item is string => Boolean(item));
  const complete = response.output?.completeTrackResults?.find(
    (item) => item.trackingNumber === trackingNumber,
  ) || response.output?.completeTrackResults?.[0];
  const detail = complete?.trackResults?.[0];

  if (!detail || detail.error) {
    return labelCreatedResult(
      trackingNumber,
      detail?.error?.message ? [...warnings, detail.error.message] : warnings,
      orderId,
    );
  }

  const latestStatus = detail.latestStatusDetail;
  const rawStatusCode = latestStatus?.code;
  const statusDescription =
    latestStatus?.statusByLocale || latestStatus?.description;
  const status = statusFromFedex(rawStatusCode, statusDescription);
  const events = mapEvents(detail);
  const lastEvent = getLastEvent(events);
  const deliveredAt = getDateTimeByType(detail, ["ACTUAL_DELIVERY"]);
  const lastCarrierUpdateAt =
    lastEvent?.timestamp ||
    getDateTimeByType(detail, ["ACTUAL_PICKUP", "SHIP", "ESTIMATED_DELIVERY"]);
  const resolvedTrackingNumber =
    detail.trackingNumberInfo?.trackingNumber ||
    complete?.trackingNumber ||
    trackingNumber;

  return {
    ok: true,
    provider: "FEDEX",
    ...(orderId ? { orderId } : {}),
    trackingNumber: resolvedTrackingNumber,
    status,
    statusLabel: fedexTrackingStatusLabels[status],
    ...(statusDescription ? { statusDescription } : {}),
    ...(lastCarrierUpdateAt ? { lastUpdatedAt: lastCarrierUpdateAt } : {}),
    ...(getEstimatedDeliveryDate(detail)
      ? { estimatedDeliveryDate: getEstimatedDeliveryDate(detail) }
      : {}),
    deliveredAt: deliveredAt || null,
    ...(normalizeLocation(lastEvent?.location || latestStatus?.scanLocation)
      ? {
          lastLocation: normalizeLocation(
            lastEvent?.location || latestStatus?.scanLocation,
          ),
        }
      : {}),
    events,
    ...(rawStatusCode ? { rawStatusCode } : {}),
    warnings,
    ...(detail.serviceDetail?.type ? { serviceType: detail.serviceDetail.type } : {}),
    ...(typeof detail.packageDetails?.count === "number"
      ? { packageCount: detail.packageDetails.count }
      : {}),
    ...(getDateTimeByType(detail, ["SHIP"])
      ? { shipDate: getDateTimeByType(detail, ["SHIP"])?.slice(0, 10) }
      : {}),
    ...(detail.recipientInformation?.address?.city
      ? { recipientCity: detail.recipientInformation.address.city }
      : {}),
    ...(detail.recipientInformation?.address?.countryCode
      ? { recipientCountryCode: detail.recipientInformation.address.countryCode }
      : {}),
  };
};
