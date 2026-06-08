import { Request, Response } from "express";
import { FedexProviderError } from "./fedex/fedex.errors";
import {
  fedexPostalCodeService,
  FedexPostalValidationError,
} from "./fedex/fedex-postal.service";
import {
  fedexAddressValidationService,
  FedexAddressValidationError,
} from "./fedex/fedex-address-validation.service";
import { FedexRateRequestConfigError } from "./fedex/fedex-rates.mapper";
import {
  FedexPublicRateError,
  fedexRatesService,
  FedexRatesUnavailableError,
} from "./fedex/fedex-rates.service";
import {
  fedexServiceAvailabilityService,
  FedexServiceAvailabilityError,
} from "./fedex/fedex-service-availability.service";
import {
  fedexShipService,
  FedexShipError,
} from "./fedex/fedex-ship.service";
import {
  fedexTrackService,
  FedexTrackError,
} from "./fedex/fedex-track.service";
import {
  fedexPickupService,
  FedexPickupError,
} from "./fedex/fedex-pickup.service";

const toSafeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "FedEx request failed";

export const quoteFedexRates = async (req: Request, res: Response) => {
  try {
    const result = await fedexRatesService.quoteRates(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexRatesUnavailableError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(422).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
        details: error.message,
      });
    }

    if (error instanceof FedexRateRequestConfigError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible cotizar el envío con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const quoteFedexPublicRates = async (req: Request, res: Response) => {
  try {
    const result = await fedexRatesService.quotePublicRates(req.body);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof FedexPublicRateError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: "FEDEX_SERVICE_UNAVAILABLE",
      message: "FedEx no esta disponible temporalmente.",
    });
  }
};

export const retrieveFedexServicesAndTransitTimes = async (
  req: Request,
  res: Response,
) => {
  try {
    const result =
      await fedexServiceAvailabilityService.retrieveServicesAndTransitTimes(
        req.body,
      );
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof FedexServiceAvailabilityError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: "FEDEX_SERVICE_UNAVAILABLE",
      message: "FedEx no esta disponible temporalmente.",
    });
  }
};

export const validateFedexAddress = async (req: Request, res: Response) => {
  try {
    const result = await fedexAddressValidationService.validateAddress(req.body);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof FedexAddressValidationError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: "FEDEX_SERVICE_UNAVAILABLE",
      message: "FedEx no esta disponible temporalmente.",
    });
  }
};

export const validateFedexPostalCode = async (req: Request, res: Response) => {
  try {
    const result = await fedexPostalCodeService.validatePostalCode(req.body);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof FedexPostalValidationError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: "FEDEX_SERVICE_UNAVAILABLE",
      message: "FedEx no esta disponible temporalmente.",
    });
  }
};

export const createFedexShipmentForOrder = async (req: Request, res: Response) => {
  try {
    const result = await fedexShipService.createShipmentForOrder(
      req.params.orderId,
      req.body,
    );
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexShipError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible generar la guía con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible generar la guía con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const createFedexTestLabel = async (req: Request, res: Response) => {
  try {
    const result = await fedexShipService.createSandboxTestLabel(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexShipError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible generar la guía con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible generar la guía con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const cancelFedexShipmentForOrder = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await fedexShipService.cancelShipmentForOrder(
      req.params.orderId,
      req.body,
      req.user,
    );
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexShipError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible cancelar la guia con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible cancelar la guia con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const cancelFedexTestShipment = async (req: Request, res: Response) => {
  try {
    const result = await fedexShipService.cancelSandboxTestShipment(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexShipError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible cancelar la guia con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible cancelar la guia con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

const parseBooleanQuery = (value: unknown): boolean =>
  value === true || value === "true" || value === "1";

export const getFedexOrderTracking = async (req: Request, res: Response) => {
  try {
    const result = await fedexTrackService.trackOrder({
      orderId: req.params.orderId,
      user: req.user,
      admin: false,
      includeDetailedScans: false,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexTrackError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible consultar el rastreo con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible consultar el rastreo con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const getAdminFedexOrderTracking = async (req: Request, res: Response) => {
  try {
    const result = await fedexTrackService.trackOrder({
      orderId: req.params.orderId,
      user: req.user,
      admin: true,
      forceRefresh: parseBooleanQuery(req.query.forceRefresh),
      includeDetailedScans: parseBooleanQuery(req.query.includeDetailedScans),
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexTrackError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible consultar el rastreo con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible consultar el rastreo con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const trackFedexNumbers = async (req: Request, res: Response) => {
  try {
    const results = await fedexTrackService.trackNumbers(req.body);
    return res.status(200).json({
      ok: true,
      provider: "FEDEX",
      results,
    });
  } catch (error) {
    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible consultar el rastreo con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible consultar el rastreo con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

const isPickupWindowError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("time window") ||
    normalized.includes("access time") ||
    normalized.includes("ready") ||
    normalized.includes("close")
  );
};

export const checkFedexPickupAvailability = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await fedexPickupService.checkAvailability(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexPickupError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible gestionar la recolección con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible gestionar la recolección con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const createFedexPickup = async (req: Request, res: Response) => {
  try {
    const result = await fedexPickupService.createPickup(req.body, req.user);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexPickupError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: isPickupWindowError(error.message)
          ? "La ventana de recolección no cumple con el horario mínimo requerido por FedEx"
          : "No fue posible gestionar la recolección con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible gestionar la recolección con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};

export const cancelFedexPickup = async (req: Request, res: Response) => {
  try {
    const result = await fedexPickupService.cancelPickup(
      req.params.pickupId,
      req.body,
    );
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FedexPickupError) {
      return res.status(error.statusCode).json({
        ok: false,
        provider: "FEDEX",
        message: error.message,
      });
    }

    if (error instanceof FedexProviderError) {
      return res.status(502).json({
        ok: false,
        provider: "FEDEX",
        message: "No fue posible gestionar la recolección con FedEx",
        details: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible gestionar la recolección con FedEx",
      details: toSafeErrorMessage(error),
    });
  }
};
