import { Router } from "express";
import { getFedexConfig } from "../modules/shipping/fedex/fedex.config";
import { fedexAuthService } from "../modules/shipping/fedex/fedex-auth.service";
import { fedexAddressService } from "../modules/shipping/fedex/fedex-address.service";
import { fedexRatesService } from "../modules/shipping/fedex/fedex-rates.service";
import {
  fedexCancelTestShipmentSchema,
  fedexShipCreateSchema,
} from "../modules/shipping/fedex/fedex-ship.types";
import { fedexTrackDirectSchema } from "../modules/shipping/fedex/fedex-track.types";
import {
  fedexPickupAvailabilitySchema,
  fedexPickupCancelSchema,
  fedexPickupCreateSchema,
  fedexPickupIdParamSchema,
} from "../modules/shipping/fedex/fedex-pickup.types";
import * as shippingController from "../modules/shipping/shipping.controller";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/error-handler";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

router.use(authMiddleware, requireAdmin);

/**
 * @swagger
 * /api/admin/fedex/auth/health:
 *   get:
 *     summary: Validar autenticaciÃ³n FedEx OAuth
 *     tags: [FedEx Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token FedEx obtenido correctamente sin exponer secretos
 */
router.get(
  "/auth/health",
  asyncHandler(async (_req, res) => {
    const config = getFedexConfig();

    await fedexAuthService.getAccessToken();
    const tokenStatus = fedexAuthService.getTokenStatus();

    return res.status(200).json({
      ok: true,
      provider: "FEDEX",
      environment: config.environment,
      tokenType: tokenStatus.tokenType,
      expiresInSeconds: tokenStatus.expiresInSeconds,
      accountConfigured: Boolean(config.accountNumber),
    });
  }),
);

/**
 * @swagger
 * /api/admin/fedex/rates/health:
 *   get:
 *     summary: Probar cotizaciÃ³n FedEx sandbox MX
 *     tags: [FedEx Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: CotizaciÃ³n FedEx probada sin exponer secretos
 */
router.get(
  "/rates/health",
  asyncHandler(async (_req, res) => {
    const quote = await fedexRatesService.quoteRates({
      origin: {
        postalCode: "37150",
        city: "Leon",
        stateOrProvinceCode: "GUA",
        countryCode: "MX",
        residential: false,
      },
      destination: {
        postalCode: "06100",
        city: "Ciudad de Mexico",
        stateOrProvinceCode: "CMX",
        countryCode: "MX",
        residential: true,
      },
      packages: [
        {
          weightKg: 1,
          lengthCm: 30,
          widthCm: 25,
          heightCm: 10,
        },
      ],
      shipDate: new Date().toISOString().slice(0, 10),
      currency: "MXN",
      rateRequestTypes: ["ACCOUNT"],
    });

    return res.status(200).json({
      ok: true,
      provider: "FEDEX",
      optionsCount: quote.options.length,
    });
  }),
);

/**
 * @swagger
 * /api/admin/fedex/address/health:
 *   get:
 *     summary: Probar validaciÃƒÂ³n de direcciÃƒÂ³n FedEx sandbox MX
 *     tags: [FedEx Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: ValidaciÃƒÂ³n FedEx probada sin exponer secretos
 */
router.get(
  "/address/health",
  asyncHandler(async (_req, res) => {
    const validation = await fedexAddressService.validateAddress({
      address: {
        streetLines: [
          "Blvd Adolfo Lopez Mateos 1810",
          "Colonia La Martinica",
        ],
        city: "Leon",
        stateOrProvinceCode: "GUA",
        postalCode: "37500",
        countryCode: "MX",
        residential: true,
      },
    });

    return res.status(200).json({
      ok: true,
      provider: "FEDEX",
      validated: validation.isValid,
    });
  }),
);

router.post(
  "/ship/test-label",
  validateBody(fedexShipCreateSchema),
  shippingController.createFedexTestLabel,
);

router.post(
  "/ship/cancel-test",
  validateBody(fedexCancelTestShipmentSchema),
  shippingController.cancelFedexTestShipment,
);

router.post(
  "/track",
  validateBody(fedexTrackDirectSchema),
  shippingController.trackFedexNumbers,
);

router.post(
  "/pickups/availability",
  validateBody(fedexPickupAvailabilitySchema),
  shippingController.checkFedexPickupAvailability,
);

router.post(
  "/pickups",
  validateBody(fedexPickupCreateSchema),
  shippingController.createFedexPickup,
);

router.post(
  "/pickups/:pickupId/cancel",
  validateParams(fedexPickupIdParamSchema),
  validateBody(fedexPickupCancelSchema),
  shippingController.cancelFedexPickup,
);

export default router;
