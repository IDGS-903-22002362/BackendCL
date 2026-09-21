import { Router } from "express";
import * as commandController from "../controllers/notifications/notifications.command.controller";
import * as queryController from "../controllers/notifications/notifications.query.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  deviceIdParamSchema,
  enqueueNotificationEventSchema,
  broadcastIdParamSchema,
  broadcastNotificationSchema,
  inboxQuerySchema,
  manualNotificationTestSchema,
  markInboxReadSchema,
  inboxNotificationIdParamSchema,
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
 * /api/notificaciones/inbox:
 *   get:
 *     summary: Listar la bandeja de notificaciones del usuario autenticado
 *     description: >
 *       Devuelve el historial in-app del usuario ordenado de la más reciente a
 *       la más antigua, junto con el total de no leídas. Incluye notificaciones
 *       cuyo push no llegó al dispositivo, porque el espejo in-app se escribe
 *       siempre que se procesa el evento.
 *       La paginación es por cursor: manda `cursor` con el `nextCursor` de la
 *       respuesta anterior para pedir la página siguiente.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *           example: "8sJk2mQpZ1aBcDeFgHiJ"
 *     responses:
 *       200:
 *         description: Bandeja obtenida
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 items:
 *                   - id: "8sJk2mQpZ1aBcDeFgHiJ"
 *                     type: "order_shipped"
 *                     category: "order"
 *                     title: "Tu pedido va en camino"
 *                     body: "Sigue tu envío desde la app"
 *                     read: false
 *                     createdAt: "2026-08-26T17:04:12.000Z"
 *                     payload:
 *                       notificationId: "evt_123:in_app"
 *                       eventId: "evt_123"
 *                       type: "order_shipped"
 *                       category: "order"
 *                       entityType: "order"
 *                       entityId: "ord_456"
 *                       deeplink: "clubleon://shop/order/ord_456"
 *                       screen: "order_detail"
 *                       priority: "high"
 *                 unreadCount: 3
 *                 nextCursor: "8sJk2mQpZ1aBcDeFgHiJ"
 *                 hasMore: true
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/inbox",
  authMiddleware,
  validateQuery(inboxQuerySchema),
  queryController.listInbox,
);

/**
 * @swagger
 * /api/notificaciones/inbox/leidas:
 *   post:
 *     summary: Marcar notificaciones de la bandeja como leídas
 *     description: >
 *       Solo se actualizan los documentos cuyo destinatario es el usuario
 *       autenticado; los ids ajenos o inexistentes se ignoran en silencio.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 maxItems: 50
 *                 items:
 *                   type: string
 *           example:
 *             ids: ["8sJk2mQpZ1aBcDeFgHiJ"]
 *     responses:
 *       200:
 *         description: Notificaciones marcadas como leídas
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Notificaciones marcadas como leídas"
 *               data:
 *                 updated: 1
 *                 unreadCount: 2
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/inbox/leidas",
  authMiddleware,
  validateBody(markInboxReadSchema),
  commandController.markInboxRead,
);

/**
 * @swagger
 * /api/notificaciones/inbox/leer-todo:
 *   post:
 *     summary: Marcar toda la bandeja del usuario como leída
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Bandeja marcada como leída
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Bandeja marcada como leída"
 *               data:
 *                 updated: 5
 *                 unreadCount: 0
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/inbox/leer-todo",
  authMiddleware,
  commandController.markAllInboxRead,
);

/**
 * @swagger
 * /api/notificaciones/inbox/{notificationId}:
 *   delete:
 *     summary: Eliminar una notificación de la bandeja del usuario
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notificación eliminada
 *       404:
 *         description: Notificación no encontrada
 */
router.delete(
  "/inbox/:notificationId",
  authMiddleware,
  validateParams(inboxNotificationIdParamSchema),
  commandController.deleteInboxNotification,
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
 * /api/notificaciones/broadcast:
 *   post:
 *     summary: Encolar una notificación push broadcast
 *     description: >
 *       Endpoint administrativo para enviar un mensaje ad-hoc a todos los
 *       dispositivos activos, o solo a una lista de userIds.
 *       Si `userIds` está vacío u omitido, se incluyen todos los usuarios con
 *       al menos un dispositivo push habilitado.
 *       El envío es asíncrono: la respuesta 202 confirma que el broadcast quedó
 *       encolado en lotes de 500 tokens. Usa
 *       `GET /api/notificaciones/broadcast/{broadcastId}` para ver el avance.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BroadcastNotification'
 *           example:
 *             title: "Hola"
 *             body: "Entra para ver novedades"
 *             deeplink: "clubleon://shop/home"
 *             screen: "home"
 *             priority: "high"
 *             userIds: []
 *     responses:
 *       202:
 *         description: Broadcast encolado
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Broadcast de notificación encolado"
 *               data:
 *                 broadcastId: "8sJk2mQpZ1aBcDeFgHiJ"
 *                 status: "queued"
 *                 targetedUsers: 4820
 *                 totalTokens: 5931
 *                 totalChunks: 12
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
  "/broadcast",
  authMiddleware,
  requireAdmin,
  validateBody(broadcastNotificationSchema),
  commandController.sendBroadcastNotification,
);

/**
 * @swagger
 * /api/notificaciones/broadcast/{broadcastId}:
 *   get:
 *     summary: Consultar el avance de un broadcast
 *     description: >
 *       Devuelve los contadores acumulados del broadcast: lotes completados,
 *       envíos exitosos, fallidos y tokens dados de baja por inválidos.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: broadcastId
 *         required: true
 *         schema:
 *           type: string
 *           example: "8sJk2mQpZ1aBcDeFgHiJ"
 *     responses:
 *       200:
 *         description: Estado del broadcast
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/broadcast/:broadcastId",
  authMiddleware,
  requireAdmin,
  validateParams(broadcastIdParamSchema),
  queryController.getBroadcastStatus,
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
