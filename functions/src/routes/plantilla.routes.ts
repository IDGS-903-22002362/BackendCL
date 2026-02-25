import { Router } from "express";
import * as queryController from "../controllers/plantilla/plantilla.query.controller";
import { validateParams } from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";

const router = Router();

/**
 * @swagger
 * /api/plantilla/{id}:
 *   get:
 *     summary: Obtener fotos de un jugador de la plantilla por ID
 *     description: Lista las imágenes almacenadas en Firebase Storage bajo plantilla/{id}/ y retorna un objeto agrupado por el ID del jugador.
 *     tags: [Plantilla]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del jugador
 *         schema:
 *           type: string
 *           example: "117808"
 *     responses:
 *       200:
 *         description: Fotos obtenidas exitosamente
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
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 *                       format: uri
 *                   example:
 *                     "117808":
 *                       - https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/plantilla/117808/foto1.jpg
 *                       - https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/plantilla/117808/foto2.jpg
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id",
  validateParams(idParamSchema),
  queryController.getFotosPorId,
);

export default router;
