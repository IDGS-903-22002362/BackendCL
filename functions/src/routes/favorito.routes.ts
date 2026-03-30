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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 meta:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                     offset:
 *                       type: integer
 *                       example: 0
 *                     returned:
 *                       type: integer
 *                       example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FavoritoConProducto'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
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
 *             $ref: '#/components/schemas/CreateFavorito'
 *     responses:
 *       201:
 *         description: Producto agregado a favoritos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Producto agregado a favoritos"
 *                 data:
 *                   $ref: '#/components/schemas/Favorito'
 *       200:
 *         description: Producto ya estaba en favoritos
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       409:
 *         description: Producto inactivo o no elegible para favoritos
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
 *         $ref: '#/components/responses/401Unauthorized'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     esFavorito:
 *                       type: boolean
 *                       example: true
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
router.get(
  "/check/:productoId",
  validateParams(productoIdParamSchema),
  queryController.checkFavorito
);

export default router;
