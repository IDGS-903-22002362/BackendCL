import { Router } from "express";
import { authMiddleware } from "../utils/middlewares";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  createFavoritoSchema,
  productoIdParamSchema,
  listFavoritosQuerySchema,
} from "../middleware/validators/favorito.validator";

import * as queryController from "../controllers/favoritos/favorito.query.controller";
import * as commandController from "../controllers/favoritos/favorito.command.controller";

const router = Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

/**
 * @swagger
 * /api/favoritos:
 *   get:
 *     summary: Listar favoritos del usuario autenticado
 *     tags: [Favoritos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Número máximo de resultados
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Desplazamiento para paginación
 *     responses:
 *       200:
 *         description: Lista de favoritos con datos de productos
 *       401:
 *         description: No autenticado
 */
router.get("/", validateQuery(listFavoritosQuerySchema), queryController.getFavoritos);

/**
 * @swagger
 * /api/favoritos:
 *   post:
 *     summary: Agregar un producto a favoritos
 *     tags: [Favoritos]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productoId
 *             properties:
 *               productoId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Producto agregado a favoritos
 *       400:
 *         description: Datos inválidos o producto no existe
 *       401:
 *         description: No autenticado
 */
router.post("/", validateBody(createFavoritoSchema), commandController.createFavorito);

/**
 * @swagger
 * /api/favoritos/{productoId}:
 *   delete:
 *     summary: Eliminar un producto de favoritos
 *     tags: [Favoritos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Producto eliminado de favoritos
 *       401:
 *         description: No autenticado
 *       404:
 *         description: El producto no está en favoritos
 */
router.delete(
  "/:productoId",
  validateParams(productoIdParamSchema),
  commandController.deleteFavorito
);

/**
 * @swagger
 * /api/favoritos/check/{productoId}:
 *   get:
 *     summary: Verificar si un producto está en favoritos
 *     tags: [Favoritos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Indica si el producto es favorito
 *       401:
 *         description: No autenticado
 */
router.get(
  "/check/:productoId",
  validateParams(productoIdParamSchema),
  queryController.checkFavorito
);

export default router;