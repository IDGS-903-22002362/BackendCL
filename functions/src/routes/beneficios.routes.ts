import { Router } from "express";
import * as queryController from "../controllers/beneficios/beneficio.query.controller";
import * as commandController from "../controllers/beneficios/beneficio.command.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";
import {
  createBeneficioSchema,
  updateBeneficioSchema,
} from "../middleware/validators/beneficio.validator";
import { authMiddleware } from "../utils/middlewares";

const router = Router();

/**
 * @swagger
 * /api/beneficios:
 *   get:
 *     summary: Listar beneficios
 *     description: Obtiene la lista completa de beneficios informativos
 *     tags: [Beneficios]
 *     responses:
 *       200:
 *         description: Lista de beneficios obtenida exitosamente
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
 *                     $ref: '#/components/schemas/Benefit'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/beneficios:
 *   post:
 *     summary: Crear beneficio
 *     description: Crea una nueva publicacion informativa de beneficios
 *     tags: [Beneficios]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBenefit'
 *     responses:
 *       201:
 *         description: Beneficio creado exitosamente
 *       400:
 *         description: Error de validacion
 *       401:
 *         description: No autorizado
 */
router.post(
  "/",
  authMiddleware,
  validateBody(createBeneficioSchema),
  commandController.create,
);

/**
 * @swagger
 * /api/beneficios/{id}:
 *   get:
 *     summary: Obtener beneficio por ID
 *     tags: [Beneficios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Beneficio encontrado
 *       404:
 *         description: Beneficio no encontrado
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

/**
 * @swagger
 * /api/beneficios/{id}:
 *   put:
 *     summary: Actualizar beneficio
 *     tags: [Beneficios]
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
 *             $ref: '#/components/schemas/UpdateBenefit'
 *     responses:
 *       200:
 *         description: Beneficio actualizado exitosamente
 *       400:
 *         description: Error de validacion
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Beneficio no encontrado
 */
router.put(
  "/:id",
  authMiddleware,
  validateParams(idParamSchema),
  validateBody(updateBeneficioSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/beneficios/{id}:
 *   delete:
 *     summary: Eliminar beneficio
 *     description: Realiza un soft delete poniendo el estatus en false
 *     tags: [Beneficios]
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
 *         description: Beneficio eliminado exitosamente
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Beneficio no encontrado
 */
router.delete(
  "/:id",
  authMiddleware,
  validateParams(idParamSchema),
  commandController.remove,
);

export default router;