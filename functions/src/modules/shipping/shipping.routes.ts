import { Router } from "express";
import { createSimpleRateLimiter } from "../../middleware/rate-limit.middleware";
import { validateBody } from "../../middleware/validation.middleware";
import { fedexAddressValidationSchema } from "./fedex/fedex-address.types";
import { fedexRateQuoteSchema } from "./fedex/fedex-rates.types";
import * as shippingController from "./shipping.controller";

const router = Router();

const fedexRatesRateLimit = createSimpleRateLimiter({
  keyPrefix: "shipping:fedex:rates",
  windowMs: 60_000,
  maxRequests: 25,
});

const fedexAddressRateLimit = createSimpleRateLimiter({
  keyPrefix: "shipping:fedex:address",
  windowMs: 60_000,
  maxRequests: 25,
});

/**
 * @swagger
 * /api/shipping/fedex/rates:
 *   post:
 *     summary: Cotizar envÃ­os FedEx
 *     tags: [Shipping]
 *     responses:
 *       200:
 *         description: Opciones normalizadas de envÃ­o FedEx
 */
router.post(
  "/fedex/rates",
  fedexRatesRateLimit,
  validateBody(fedexRateQuoteSchema),
  shippingController.quoteFedexRates,
);

/**
 * @swagger
 * /api/shipping/fedex/address/validate:
 *   post:
 *     summary: Validar y normalizar direcciones con FedEx
 *     tags: [Shipping]
 *     responses:
 *       200:
 *         description: Resultado normalizado de validaciÃƒÂ³n de direcciÃƒÂ³n FedEx
 */
router.post(
  "/fedex/address/validate",
  fedexAddressRateLimit,
  validateBody(fedexAddressValidationSchema),
  shippingController.validateFedexAddress,
);

export default router;
