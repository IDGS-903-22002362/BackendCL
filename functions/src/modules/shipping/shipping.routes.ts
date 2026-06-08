import { Router } from "express";
import { createSimpleRateLimiter } from "../../middleware/rate-limit.middleware";
import { validateBody } from "../../middleware/validation.middleware";
import { fedexAddressValidationPublicSchema } from "./fedex/fedex-address-validation.types";
import { fedexPostalValidationSchema } from "./fedex/fedex-postal.types";
import { fedexServiceAvailabilitySchema } from "./fedex/fedex-service-availability.types";
import {
  fedexPublicRateQuoteSchema,
  fedexRateQuoteSchema,
} from "./fedex/fedex-rates.types";
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

const fedexPostalRateLimit = createSimpleRateLimiter({
  keyPrefix: "shipping:fedex:postal",
  windowMs: 60_000,
  maxRequests: 25,
});

const fedexAvailabilityRateLimit = createSimpleRateLimiter({
  keyPrefix: "shipping:fedex:availability",
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
 * /api/shipping/fedex/rates/quote:
 *   post:
 *     summary: Cotizar tarifas FedEx publicas estimadas
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipient
 *               - packages
 *             properties:
 *               recipient:
 *                 type: object
 *                 properties:
 *                   streetLines:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["Blvd Adolfo Lopez Mateos 1810"]
 *                   city:
 *                     type: string
 *                     example: Leon
 *                   stateOrProvinceCode:
 *                     type: string
 *                     example: GTO
 *                   postalCode:
 *                     type: string
 *                     example: "37500"
 *                   countryCode:
 *                     type: string
 *                     example: MX
 *                   residential:
 *                     type: boolean
 *                     example: true
 *               packages:
 *                 type: array
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   properties:
 *                     weightKg:
 *                       type: number
 *                       example: 1.25
 *                     lengthCm:
 *                       type: number
 *                       example: 30
 *                     widthCm:
 *                       type: number
 *                       example: 20
 *                     heightCm:
 *                       type: number
 *                       example: 10
 *                     declaredValue:
 *                       type: number
 *                       example: 1200
 *                     quantity:
 *                       type: integer
 *                       example: 1
 *               returnTransitTimes:
 *                 type: boolean
 *                 example: true
 *               carrierCodes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [FDXE, FDXG, FXSP, FXCC]
 *                 example: [FDXE, FDXG]
 *               preferredCurrency:
 *                 type: string
 *                 example: MXN
 *     responses:
 *       200:
 *         description: Tarifas FedEx normalizadas
 *       400:
 *         description: Datos invalidos para cotizacion
 *       401:
 *         description: FedEx no pudo autenticar la solicitud
 *       403:
 *         description: Credenciales sin permisos para cotizar
 *       404:
 *         description: Recurso FedEx no disponible
 *       422:
 *         description: FedEx no devolvio tarifas o no pudo procesar la cotizacion
 *       429:
 *         description: Demasiadas solicitudes
 *       500:
 *         description: FedEx no disponible
 *       503:
 *         description: FedEx no disponible temporalmente
 */
router.post(
  "/fedex/rates/quote",
  fedexRatesRateLimit,
  validateBody(fedexPublicRateQuoteSchema),
  shippingController.quoteFedexPublicRates,
);

/**
 * @swagger
 * /api/shipping/fedex/availability/transit-times:
 *   post:
 *     summary: Consultar servicios y tiempos de transito FedEx
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipient
 *               - packages
 *             properties:
 *               recipient:
 *                 type: object
 *                 properties:
 *                   streetLines:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["Blvd Adolfo Lopez Mateos 1810"]
 *                   city:
 *                     type: string
 *                     example: Leon
 *                   stateOrProvinceCode:
 *                     type: string
 *                     example: GTO
 *                   postalCode:
 *                     type: string
 *                     example: "37500"
 *                   countryCode:
 *                     type: string
 *                     example: MX
 *                   residential:
 *                     type: boolean
 *                     example: true
 *               packages:
 *                 type: array
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   properties:
 *                     weightKg:
 *                       type: number
 *                       example: 1.25
 *                     lengthCm:
 *                       type: number
 *                       example: 30
 *                     widthCm:
 *                       type: number
 *                       example: 20
 *                     heightCm:
 *                       type: number
 *                       example: 10
 *                     declaredValue:
 *                       type: number
 *                       example: 1200
 *                     quantity:
 *                       type: integer
 *                       example: 1
 *               carrierCodes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [FDXE, FDXG, FXSP]
 *                 example: [FDXE, FDXG]
 *               packagingType:
 *                 type: string
 *                 example: YOUR_PACKAGING
 *               pickupType:
 *                 type: string
 *                 example: DROPOFF_AT_FEDEX_LOCATION
 *               preferredCurrency:
 *                 type: string
 *                 example: MXN
 *     responses:
 *       200:
 *         description: Servicios FedEx disponibles normalizados
 *       400:
 *         description: Datos invalidos para disponibilidad
 *       401:
 *         description: FedEx no pudo autenticar la solicitud
 *       403:
 *         description: Credenciales sin permisos para disponibilidad
 *       404:
 *         description: Recurso FedEx no disponible
 *       422:
 *         description: FedEx no devolvio servicios o no pudo procesar la solicitud
 *       429:
 *         description: Demasiadas solicitudes
 *       500:
 *         description: FedEx no disponible
 *       503:
 *         description: FedEx no disponible temporalmente
 */
router.post(
  "/fedex/availability/transit-times",
  fedexAvailabilityRateLimit,
  validateBody(fedexServiceAvailabilitySchema),
  shippingController.retrieveFedexServicesAndTransitTimes,
);

/**
 * @swagger
 * /api/shipping/fedex/address/validate:
 *   post:
 *     summary: Validar y sugerir una direccion con FedEx
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - streetLines
 *               - countryCode
 *             properties:
 *               streetLines:
 *                 type: array
 *                 maxItems: 3
 *                 items:
 *                   type: string
 *                 example: ["Blvd Adolfo Lopez Mateos 1810"]
 *               city:
 *                 type: string
 *                 example: Leon
 *               stateOrProvinceCode:
 *                 type: string
 *                 example: GTO
 *               postalCode:
 *                 type: string
 *                 example: "37500"
 *               countryCode:
 *                 type: string
 *                 example: MX
 *               clientReferenceId:
 *                 type: string
 *                 example: checkout-address-1
 *               includeResolutionTokens:
 *                 type: boolean
 *                 example: true
 *               inEffectAsOfTimestamp:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-19"
 *     responses:
 *       200:
 *         description: Resultado normalizado de validacion de direccion FedEx
 *       400:
 *         description: Datos invalidos para validacion de direccion
 *       401:
 *         description: FedEx no pudo autenticar la solicitud
 *       403:
 *         description: Credenciales sin permisos para Address Validation
 *       404:
 *         description: Recurso FedEx no disponible
 *       422:
 *         description: Direccion no procesable por FedEx
 *       429:
 *         description: Demasiadas solicitudes
 *       500:
 *         description: FedEx no disponible
 *       503:
 *         description: FedEx no disponible temporalmente
 */
router.post(
  "/fedex/address/validate",
  fedexAddressRateLimit,
  validateBody(fedexAddressValidationPublicSchema),
  shippingController.validateFedexAddress,
);

/**
 * @swagger
 * /api/shipping/fedex/postal/validate:
 *   post:
 *     summary: Validar codigo postal con FedEx
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - countryCode
 *               - postalCode
 *             properties:
 *               carrierCode:
 *                 type: string
 *                 enum: [FDXE, FDXG, FXSP, FDXC, FXCC]
 *                 example: FDXE
 *               countryCode:
 *                 type: string
 *                 example: MX
 *               stateOrProvinceCode:
 *                 type: string
 *                 example: CS
 *               postalCode:
 *                 type: string
 *                 example: "30709"
 *               shipDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-05-20"
 *               checkForMismatch:
 *                 type: boolean
 *                 example: false
 *               city:
 *                 type: string
 *                 example: Tapachula
 *     responses:
 *       200:
 *         description: Resultado normalizado de validacion postal FedEx
 *       400:
 *         description: Datos invalidos para validacion postal
 *       422:
 *         description: Pais, estado o codigo postal no procesable por FedEx
 *       429:
 *         description: Demasiadas solicitudes
 *       500:
 *         description: FedEx no disponible
 *       503:
 *         description: FedEx no disponible temporalmente
 */
router.post(
  "/fedex/postal/validate",
  fedexPostalRateLimit,
  validateBody(fedexPostalValidationSchema),
  shippingController.validateFedexPostalCode,
);

export default router;
