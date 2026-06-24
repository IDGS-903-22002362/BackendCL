import { Router } from "express";

import { ofertasCommandController } from "../controllers/ofertas/ofertas.command.controller";
import { ofertasQueryController } from "../controllers/ofertas/ofertas.query.controller";

import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";

import {
  calcularPreciosOfertaSchema,
  createOfertaSchema,
  listarOfertasQuerySchema,
  ofertaIdParamSchema,
  syncOfferSnapshotsSchema,
  updateOfertaSchema,
} from "../middleware/validators/ofertas.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

/**
 * @swagger
 * /api/ofertas:
 *   get:
 *     summary: Listar ofertas
 *     description: Lista ofertas con filtros opcionales por estado, alcance, tipo de descuento, producto, categoría, línea, talla o texto.
 *     tags:
 *       - Ofertas
 *     parameters:
 *       - in: query
 *         name: estado
 *         schema:
 *           type: boolean
 *         description: Filtra ofertas habilitadas o deshabilitadas.
 *       - in: query
 *         name: aplicaA
 *         schema:
 *           type: string
 *           enum: [productos, categorias, lineas, todo]
 *         description: Filtra ofertas por alcance.
 *       - in: query
 *         name: tipoDescuento
 *         schema:
 *           type: string
 *           enum: [precio_fijo, porcentaje, monto]
 *         description: Filtra ofertas por tipo de descuento.
 *       - in: query
 *         name: productoId
 *         schema:
 *           type: string
 *         description: Filtra ofertas aplicables a un producto específico.
 *       - in: query
 *         name: categoriaId
 *         schema:
 *           type: string
 *         description: Filtra ofertas aplicables a una categoría específica.
 *       - in: query
 *         name: lineaId
 *         schema:
 *           type: string
 *         description: Filtra ofertas aplicables a una línea específica.
 *       - in: query
 *         name: tallaId
 *         schema:
 *           type: string
 *         description: Filtra ofertas aplicables a una talla específica.
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Búsqueda por texto.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Límite de resultados.
 *     responses:
 *       200:
 *         description: Lista de ofertas obtenida correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Oferta'
 *       400:
 *         description: Parámetros de consulta inválidos.
 */
router.get(
  "/",
  validateQuery(listarOfertasQuerySchema),
  ofertasQueryController.listar
);

/**
 * @swagger
 * /api/ofertas/activas:
 *   get:
 *     summary: Listar ofertas activas
 *     description: Lista las ofertas habilitadas, vigentes y disponibles para la tienda.
 *     tags:
 *       - Ofertas
 *     responses:
 *       200:
 *         description: Lista de ofertas activas obtenida correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Oferta'
 */
router.get(
  "/activas",
  ofertasQueryController.listarActivas
);

/**
 * @swagger
 * /api/ofertas/calcular-precios:
 *   post:
 *     summary: Calcular precios con ofertas
 *     description: Calcula precios finales de productos considerando las ofertas aplicables por producto, categoría, línea y talla.
 *     tags:
 *       - Ofertas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CalcularPreciosOferta'
 *     responses:
 *       200:
 *         description: Precios calculados correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ResultadoCalculoOfertas'
 *       400:
 *         description: Datos inválidos.
 */
router.post(
  "/calcular-precios",
  validateBody(calcularPreciosOfertaSchema),
  ofertasQueryController.calcularPrecios
);

/**
 * @swagger
 * /api/ofertas/admin/sync-snapshots:
 *   post:
 *     summary: Sincronizar snapshots de ofertas en productos
 *     description: Recalcula campos denormalizados de oferta en productos activos. Requiere admin.
 *     tags:
 *       - Ofertas
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 500
 *     responses:
 *       200:
 *         description: Snapshots sincronizados correctamente.
 */
router.post(
  "/admin/sync-snapshots",
  authMiddleware,
  requireAdmin,
  validateBody(syncOfferSnapshotsSchema),
  ofertasCommandController.sincronizarSnapshots
);

/**
 * @swagger
 * /api/ofertas/{id}:
 *   get:
 *     summary: Obtener oferta por ID
 *     description: Obtiene el detalle de una oferta específica.
 *     tags:
 *       - Ofertas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la oferta.
 *     responses:
 *       200:
 *         description: Oferta obtenida correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Oferta'
 *       400:
 *         description: Parámetros inválidos.
 *       404:
 *         description: Oferta no encontrada.
 */
router.get(
  "/:id",
  validateParams(ofertaIdParamSchema),
  ofertasQueryController.obtenerPorId
);

/**
 * @swagger
 * /api/ofertas:
 *   post:
 *     summary: Crear oferta
 *     description: Crea una nueva oferta. Pendiente conectar autenticación y autorización admin.
 *     tags:
 *       - Ofertas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOferta'
 *     responses:
 *       201:
 *         description: Oferta creada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Oferta'
 *       400:
 *         description: Datos inválidos.
 */
router.post(
  "/",
  authMiddleware,
  requireAdmin,
  validateBody(createOfertaSchema),
  ofertasCommandController.crear
);

/**
 * @swagger
 * /api/ofertas/{id}:
 *   put:
 *     summary: Actualizar oferta
 *     description: Actualiza una oferta existente. Pendiente conectar autenticación y autorización admin.
 *     tags:
 *       - Ofertas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la oferta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateOferta'
 *     responses:
 *       200:
 *         description: Oferta actualizada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Oferta'
 *       400:
 *         description: Datos o parámetros inválidos.
 *       404:
 *         description: Oferta no encontrada.
 */
router.put(
  "/:id",
  authMiddleware,
  requireAdmin,
  validateParams(ofertaIdParamSchema),
  validateBody(updateOfertaSchema),
  ofertasCommandController.actualizar
);

/**
 * @swagger
 * /api/ofertas/{id}:
 *   delete:
 *     summary: Eliminar oferta
 *     description: Elimina permanentemente una oferta desactivada o vencida. Requiere admin. No permite eliminar ofertas activas o programadas.
 *     tags:
 *       - Ofertas
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la oferta.
 *     responses:
 *       200:
 *         description: Oferta eliminada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Oferta eliminada correctamente
 *       400:
 *         description: Parámetros inválidos o la oferta sigue activa/programada.
 *       401:
 *         description: No autenticado.
 *       403:
 *         description: No autorizado.
 *       404:
 *         description: Oferta no encontrada.
 */
router.delete(
  "/:id",
  authMiddleware,
  requireAdmin,
  validateParams(ofertaIdParamSchema),
  ofertasCommandController.eliminar
);

export default router;