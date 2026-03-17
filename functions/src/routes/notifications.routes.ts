import { Router } from "express";
import * as commandController from "../controllers/notifications/notifications.command.controller";
import * as queryController from "../controllers/notifications/notifications.query.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  deviceIdParamSchema,
  enqueueNotificationEventSchema,
  manualNotificationTestSchema,
  registerDeviceTokenSchema,
  updateDeviceTokenSchema,
  updateNotificationPreferencesSchema,
} from "../middleware/validators/notification.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

/**
 * @swagger
 * /api/notificaciones/dispositivos:
 *   post:
 *     summary: Registrar token FCM del dispositivo
 *     description: Registra o actualiza el token FCM del dispositivo autenticado.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterDeviceToken'
 *           example:
 *             deviceId: "pixel-8-pro"
 *             token: "fcm_token_largo_del_dispositivo"
 *             platform: "android"
 *             locale: "es-MX"
 *             timezone: "America/Mexico_City"
 *             appVersion: "1.4.0"
 *             buildNumber: "140"
 *     responses:
 *       201:
 *         description: Token registrado exitosamente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/dispositivos",
  authMiddleware,
  validateBody(registerDeviceTokenSchema),
  commandController.registerDevice,
);

/**
 * @swagger
 * /api/notificaciones/dispositivos/{deviceId}:
 *   put:
 *     summary: Actualizar token o metadata del dispositivo
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           example: "pixel-8-pro"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDeviceToken'
 *     responses:
 *       200:
 *         description: Dispositivo actualizado
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/dispositivos/:deviceId",
  authMiddleware,
  validateParams(deviceIdParamSchema),
  validateBody(updateDeviceTokenSchema),
  commandController.updateDevice,
);

/**
 * @swagger
 * /api/notificaciones/dispositivos/{deviceId}:
 *   delete:
 *     summary: Desactivar dispositivo push
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           example: "pixel-8-pro"
 *     responses:
 *       200:
 *         description: Dispositivo desactivado
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete(
  "/dispositivos/:deviceId",
  authMiddleware,
  validateParams(deviceIdParamSchema),
  commandController.deactivateDevice,
);

/**
 * @swagger
 * /api/notificaciones/preferencias:
 *   get:
 *     summary: Obtener preferencias push del usuario autenticado
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Preferencias obtenidas
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/preferencias", authMiddleware, queryController.getPreferences);

/**
 * @swagger
 * /api/notificaciones/preferencias:
 *   put:
 *     summary: Actualizar preferencias push del usuario autenticado
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateNotificationPreferences'
 *           example:
 *             marketingEnabled: true
 *             cartRemindersEnabled: false
 *             quietHours:
 *               enabled: true
 *               startHour: 22
 *               endHour: 9
 *             timezone: "America/Mexico_City"
 *     responses:
 *       200:
 *         description: Preferencias actualizadas
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/preferencias",
  authMiddleware,
  validateBody(updateNotificationPreferencesSchema),
  commandController.updatePreferences,
);

/**
 * @swagger
 * /api/notificaciones/prueba:
 *   post:
 *     summary: Enviar una notificación push de prueba
 *     description: Endpoint administrativo para validar el pipeline completo de generación y envío.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ManualNotificationTest'
 *           example:
 *             userId: "uid_123"
 *             title: "Prueba Club León"
 *             body: "Esta es una prueba del backend"
 *             deeplink: "clubleon://shop/cart"
 *             screen: "cart"
 *             priority: "high"
 *     responses:
 *       200:
 *         description: Notificación de prueba procesada
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/prueba",
  authMiddleware,
  requireAdmin,
  validateBody(manualNotificationTestSchema),
  commandController.sendTestNotification,
);

/**
 * @swagger
 * /api/notificaciones/eventos:
 *   post:
 *     summary: Reinyectar o encolar un evento notificable interno
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EnqueueNotificationEvent'
 *     responses:
 *       201:
 *         description: Evento encolado
 *       200:
 *         description: Evento ya existente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/eventos",
  authMiddleware,
  requireAdmin,
  validateBody(enqueueNotificationEventSchema),
  commandController.enqueueEvent,
);

export default router;
