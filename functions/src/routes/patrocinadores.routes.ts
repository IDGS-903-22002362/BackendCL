import { Router } from "express";
import * as queryController from "../controllers/patrocinadores/patrocinador.query.controller";
import * as commandController from "../controllers/patrocinadores/patrocinador.command.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";
import {
  createPatrocinadorSchema,
  patrocinadorImagenParamsSchema,
  updatePatrocinadorSchema,
} from "../middleware/validators/patrocinador.validator";
import { authMiddleware } from "../utils/middlewares";
import { handleMultipart } from "../middleware/multipart-handler";
import { verifyRole } from "../middleware/validation.middleware";
import { RolUsuario } from "../models/usuario.model";

const PATROCINADORES_STAFF_ROLES = [
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
  RolUsuario.EMPLEADO_CLUB,
];

const router = Router();

/**
 * @swagger
 * /api/patrocinadores:
 *   get:
 *     summary: Listar patrocinadores
 *     description: Obtiene la lista completa de patrocinadores ordenados por el campo orden
 *     tags: [Patrocinadores]
 *     responses:
 *       200:
 *         description: Lista de patrocinadores obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Sponsor'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/patrocinadores:
 *   post:
 *     summary: Crear patrocinador
 *     description: Crea un nuevo patrocinador. Los logos blanco y negro se suben en un paso posterior.
 *     tags: [Patrocinadores]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSponsor'
 *     responses:
 *       201:
 *         description: Patrocinador creado exitosamente
 *       400:
 *         description: Error de validacion
 *       401:
 *         description: No autorizado
 */
router.post(
  "/",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateBody(createPatrocinadorSchema),
  commandController.create,
);

/**
 * @swagger
 * /api/patrocinadores/{id}:
 *   get:
 *     summary: Obtener patrocinador por ID
 *     tags: [Patrocinadores]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Patrocinador encontrado
 *       404:
 *         description: Patrocinador no encontrado
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

/**
 * @swagger
 * /api/patrocinadores/{id}:
 *   put:
 *     summary: Actualizar patrocinador
 *     tags: [Patrocinadores]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSponsor'
 *     responses:
 *       200:
 *         description: Patrocinador actualizado exitosamente
 *       400:
 *         description: Error de validacion
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Patrocinador no encontrado
 */
router.put(
  "/:id",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateParams(idParamSchema),
  validateBody(updatePatrocinadorSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/patrocinadores/{id}:
 *   delete:
 *     summary: Desactivar patrocinador
 *     description: Realiza un soft delete poniendo el estatus en false
 *     tags: [Patrocinadores]
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
 *         description: Patrocinador desactivado exitosamente
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Patrocinador no encontrado
 */
router.delete(
  "/:id",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateParams(idParamSchema),
  commandController.remove,
);

router.post(
  "/:id/imagen/:variante",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateParams(patrocinadorImagenParamsSchema),
  handleMultipart({
    maxFiles: 1,
    maxFileSize: 32 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  }),
  commandController.uploadImage,
);

router.delete(
  "/:id/permanente",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateParams(idParamSchema),
  commandController.destroyPermanently,
);

router.delete(
  "/:id/imagen/:variante",
  authMiddleware,
  verifyRole(PATROCINADORES_STAFF_ROLES),
  validateParams(patrocinadorImagenParamsSchema),
  commandController.removeImage,
);

export default router;
