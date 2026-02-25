import { Router } from "express";
import * as queryController from "../controllers/plantilla/plantilla.query.controller";
import { validateParams } from "../middleware/validation.middleware";
import { jugadorParamSchema } from "../middleware/validators/common.validator";

const router = Router();

/**
 * @swagger
 * /api/plantilla/{jugador}:
 *   get:
 *     summary: Obtener fotos de un jugador de la plantilla
 *     description: Lista las imágenes almacenadas en Firebase Storage bajo plantilla/{jugador}/ y retorna un objeto agrupado por nombre de jugador.
 *     tags: [Plantilla]
 *     parameters:
 *       - in: path
 *         name: jugador
 *         required: true
 *         description: Nombre de carpeta del jugador en Storage
 *         schema:
 *           type: string
 *           example: "barreiro"
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
 *                     barreiro:
 *                       - https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/plantilla/barreiro/foto1.jpg
 *                       - https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/plantilla/barreiro/foto2.jpg
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:jugador",
  validateParams(jugadorParamSchema),
  queryController.getFotosPorJugador,
);

export default router;
