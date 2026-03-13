import { Router } from "express";
import { authMiddleware } from "../utils/middlewares";
import { asyncHandler } from "../utils/error-handler";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createAiSessionSchema,
  sessionIdParamSchema,
} from "../middleware/validators/ai-session.validator";
import { sendAiMessageSchema } from "../middleware/validators/ai-chat.validator";
import {
  createTryOnJobSchema,
  tryOnJobIdParamSchema,
} from "../middleware/validators/ai-tryon.validator";
import {
  aiChatRateLimiter,
  aiTryOnRateLimiter,
  aiUploadRateLimiter,
} from "../middleware/ai-rate-limit.middleware";
import { requireAiAdmin } from "../middleware/ai-authz.middleware";
import { aiUploadMiddleware } from "../services/ai/storage/ai-upload.middleware";
import * as chatController from "../controllers/ai/chat.controller";
import * as filesController from "../controllers/ai/files.controller";
import * as tryonController from "../controllers/ai/tryon.controller";
import * as adminController from "../controllers/ai/admin.controller";

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/ai/chat/sessions:
 *   post:
 *     summary: Crear una sesión de chat AI
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAiSession'
 *     responses:
 *       201:
 *         $ref: '#/components/responses/201Created'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.post(
  "/chat/sessions",
  aiChatRateLimiter,
  validateBody(createAiSessionSchema),
  asyncHandler(chatController.createSession),
);
/**
 * @swagger
 * /api/ai/chat/sessions:
 *   get:
 *     summary: Listar sesiones AI del usuario autenticado
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.get(
  "/chat/sessions",
  aiChatRateLimiter,
  asyncHandler(chatController.listSessions),
);
/**
 * @swagger
 * /api/ai/chat/sessions/{id}:
 *   get:
 *     summary: Obtener detalle de una sesión AI
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 */
router.get(
  "/chat/sessions/:id",
  aiChatRateLimiter,
  validateParams(sessionIdParamSchema),
  asyncHandler(chatController.getSessionDetail),
);
/**
 * @swagger
 * /api/ai/chat/messages:
 *   post:
 *     summary: Enviar mensaje al agente AI
 *     description: |
 *       Si stream=true, responde como Server-Sent Events (SSE) con la secuencia de eventos `status` -> `final` -> `done`.
 *       Si stream no se envia o es false, responde JSON estandar.
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendAiMessage'
 *     responses:
 *       200:
 *         description: Respuesta del agente (JSON o stream SSE)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                     model:
 *                       type: string
 *                     latencyMs:
 *                       type: number
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: status
 *                 data: {"status":"processing"}
 *
 *                 event: final
 *                 data: {"text":"Respuesta del agente"}
 *
 *                 event: done
 *                 data: {}
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/chat/messages",
  aiChatRateLimiter,
  validateBody(sendAiMessageSchema),
  asyncHandler(chatController.sendMessage),
);

/**
 * @swagger
 * /api/ai/files/upload:
 *   post:
 *     summary: Subir imagen privada para try-on
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               sessionId:
 *                 type: string
 *     responses:
 *       201:
 *         $ref: '#/components/responses/201Created'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.post(
  "/files/upload",
  aiUploadRateLimiter,
  aiUploadMiddleware.single("file"),
  asyncHandler(filesController.uploadUserImage),
);

/**
 * @swagger
 * /api/ai/tryon/jobs:
 *   post:
 *     summary: Crear job de virtual try-on
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTryOnJob'
 *     responses:
 *       201:
 *         $ref: '#/components/responses/201Created'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.post(
  "/tryon/jobs",
  aiTryOnRateLimiter,
  validateBody(createTryOnJobSchema),
  asyncHandler(tryonController.createTryOnJob),
);
/**
 * @swagger
 * /api/ai/tryon/jobs:
 *   get:
 *     summary: Listar jobs de try-on del usuario autenticado
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.get(
  "/tryon/jobs",
  aiTryOnRateLimiter,
  asyncHandler(tryonController.listTryOnJobs),
);
/**
 * @swagger
 * /api/ai/tryon/jobs/{id}:
 *   get:
 *     summary: Obtener estado de un job de try-on
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 */
router.get(
  "/tryon/jobs/:id",
  aiTryOnRateLimiter,
  validateParams(tryOnJobIdParamSchema),
  asyncHandler(tryonController.getTryOnJob),
);
/**
 * @swagger
 * /api/ai/tryon/jobs/{id}/download:
 *   get:
 *     summary: Obtener link firmado de descarga del resultado de try-on
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 */
router.get(
  "/tryon/jobs/:id/download",
  aiTryOnRateLimiter,
  validateParams(tryOnJobIdParamSchema),
  asyncHandler(tryonController.getTryOnDownloadLink),
);

/**
 * @swagger
 * /api/ai/admin/metrics:
 *   get:
 *     summary: Obtener métricas agregadas del módulo AI
 *     tags: [AI Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 */
router.get(
  "/admin/metrics",
  requireAiAdmin,
  asyncHandler(adminController.getMetrics),
);
/**
 * @swagger
 * /api/ai/admin/jobs:
 *   get:
 *     summary: Listar jobs recientes del módulo AI
 *     tags: [AI Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 */
router.get(
  "/admin/jobs",
  requireAiAdmin,
  asyncHandler(adminController.listJobs),
);

export default router;
