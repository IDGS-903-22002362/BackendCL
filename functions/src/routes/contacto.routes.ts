// contacto.routes.ts
import { Router } from "express";
import {
    create
} from "../controllers/contacto/contacto.command.controller";
import {
    getAll,
    getById,
    updateStatus,
    deleteContacto
} from "../controllers/contacto/contacto.query.controller";
import {
    optionalAuthMiddleware,
    authMiddleware,
    requireAdmin
} from "../utils/middlewares";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Contacto
 *   description: Gestión de solicitudes de contacto y soporte
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Contacto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "abc123"
 *         uid:
 *           type: string
 *           nullable: true
 *           example: "user_uid_123"
 *         nombre:
 *           type: string
 *           example: "Juan Pérez"
 *         email:
 *           type: string
 *           format: email
 *           example: "juan@email.com"
 *         telefono:
 *           type: string
 *           nullable: true
 *           example: "4771234567"
 *         asunto:
 *           type: string
 *           example: "Consulta sobre tallas"
 *         mensaje:
 *           type: string
 *           example: "Hola, quisiera saber..."
 *         estatus:
 *           type: string
 *           enum: [PENDIENTE, ATENDIDO, CERRADO]
 *           example: "PENDIENTE"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00.000Z"
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Error description"
 *     CreateContactoRequest:
 *       type: object
 *       required:
 *         - nombre
 *         - email
 *         - asunto
 *         - mensaje
 *       properties:
 *         nombre:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *           example: "Juan Pérez"
 *         email:
 *           type: string
 *           format: email
 *           example: "juan@email.com"
 *         telefono:
 *           type: string
 *           maxLength: 20
 *           example: "4771234567"
 *         asunto:
 *           type: string
 *           minLength: 1
 *           maxLength: 150
 *           example: "Consulta sobre tallas"
 *         mensaje:
 *           type: string
 *           minLength: 1
 *           maxLength: 5000
 *           example: "Hola, quisiera saber..."
 *     UpdateContactoStatusRequest:
 *       type: object
 *       required:
 *         - estatus
 *       properties:
 *         estatus:
 *           type: string
 *           enum: [PENDIENTE, ATENDIDO, CERRADO]
 *           example: ATENDIDO
 */

/**
 * @swagger
 * /api/contacto:
 *   post:
 *     summary: Crear una nueva solicitud de contacto
 *     description: |
 *       Endpoint público para que los usuarios envíen consultas, sugerencias o reportes.
 *       No requiere autenticación, pero si el usuario está logueado se asocia su UID.
 *       Envía email de confirmación al usuario y notificación al equipo de soporte.
 *     tags: [Contacto]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateContactoRequest'
 *     responses:
 *       201:
 *         description: Solicitud creada exitosamente
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
 *                   example: "Solicitud enviada correctamente"
 *                 data:
 *                   $ref: '#/components/schemas/Contacto'
 *       400:
 *         description: Datos de entrada inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
    "/",
    optionalAuthMiddleware,
    create
);

/**
 * @swagger
 * /api/contacto:
 *   get:
 *     summary: Obtener todas las solicitudes de contacto
 *     description: |
 *       Endpoint privado para administradores. Requiere autenticación y rol ADMIN/EMPLEADO.
 *       Retorna la lista completa de contactos ordenados por fecha descendente.
 *     tags: [Contacto]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de contactos obtenida exitosamente
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
 *                   example: 25
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Contacto'
 *       401:
 *         description: No autenticado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Sin permisos de administrador
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    "/",
    authMiddleware,
    requireAdmin,
    getAll
);

/**
 * @swagger
 * /api/contacto/{id}:
 *   get:
 *     summary: Obtener un contacto por ID
 *     description: Endpoint privado para administradores.
 *     tags: [Contacto]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del contacto
 *     responses:
 *       200:
 *         description: Contacto encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Contacto'
 *       404:
 *         description: Contacto no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    "/:id",
    authMiddleware,
    requireAdmin,
    getById
);

/**
 * @swagger
 * /api/contacto/{id}:
 *   patch:
 *     summary: Actualizar estado de un contacto
 *     description: Endpoint privado para administradores. Permite cambiar el estado (PENDIENTE, ATENDIDO, CERRADO).
 *     tags: [Contacto]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del contacto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateContactoStatusRequest'
 *     responses:
 *       200:
 *         description: Estado actualizado
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
 *                   example: "Estado actualizado correctamente"
 *       400:
 *         description: Estado inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Contacto no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch(
    "/:id",
    authMiddleware,
    requireAdmin,
    updateStatus
);

/**
 * @swagger
 * /api/contacto/{id}:
 *   delete:
 *     summary: Eliminar un contacto
 *     description: Endpoint privado para administradores. Elimina permanentemente el registro.
 *     tags: [Contacto]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del contacto
 *     responses:
 *       200:
 *         description: Contacto eliminado
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
 *                   example: "Contacto eliminado correctamente"
 *       404:
 *         description: Contacto no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
    "/:id",
    authMiddleware,
    requireAdmin,
    deleteContacto
);

export default router;