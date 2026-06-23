import { Request, Response } from "express";
import contactoService from "../../services/contacto.service";
import { ApiError } from "../../lib/api/client";
import { EstadoContacto } from "../../models/contacto.model";

/**
 * @swagger
 * /contacto:
 *   get:
 *     summary: Obtener todas las solicitudes de contacto
 *     description: |
       Endpoint privado para administradores. Requiere autenticación y rol ADMIN/EMPLEADO.
       Retorna la lista completa de contactos ordenados por fecha descendente.
 *     tags:
       - Contacto
 *     security:
       - bearerAuth: []
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
export const getAll = async (
    _req: Request,
    res: Response
) => {
    try {
        const contactos = await contactoService.getAll();

        return res.status(200).json({
            success: true,
            count: contactos.length,
            data: contactos
        });
    } catch (error) {
        console.error("Error en contacto.getAll:", error);

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error obteniendo contactos"
        });
    }
};

/**
 * @swagger
 * /contacto/{id}:
 *   get:
 *     summary: Obtener un contacto por ID
 *     description: Endpoint privado para administradores.
 *     tags:
       - Contacto
 *     security:
       - bearerAuth: []
 *     parameters:
       - in: path
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
 */
export const getById = async (
    req: Request,
    res: Response
) => {
    try {
        const { id } = req.params;
        const contacto = await contactoService.getById(id);

        if (!contacto) {
            throw new ApiError(404, "Contacto no encontrado");
        }

        return res.status(200).json({
            success: true,
            data: contacto
        });
    } catch (error) {
        console.error("Error en contacto.getById:", error);

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error obteniendo contacto"
        });
    }
};

/**
 * @swagger
 * /contacto/{id}:
 *   patch:
 *     summary: Actualizar estado de un contacto
 *     description: Endpoint privado para administradores. Permite cambiar el estado (PENDIENTE, ATENDIDO, CERRADO).
 *     tags:
       - Contacto
 *     security:
       - bearerAuth: []
 *     parameters:
       - in: path
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
 *             type: object
 *             required:
 *               - estatus
 *             properties:
 *               estatus:
 *                 type: string
 *                 enum: [PENDIENTE, ATENDIDO, CERRADO]
 *                 example: ATENDIDO
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
 *       404:
 *         description: Contacto no encontrado
 *       500:
 *         description: Error interno
 */
export const updateStatus = async (
    req: Request,
    res: Response
) => {
    try {
        const { id } = req.params;
        const { estatus } = req.body;

        const validEstados: EstadoContacto[] = [EstadoContacto.PENDIENTE, EstadoContacto.ATENDIDO, EstadoContacto.CERRADO];

        if (!estatus || !validEstados.includes(estatus as EstadoContacto)) {
            throw new ApiError(400, "Estado inválido. Valores permitidos: PENDIENTE, ATENDIDO, CERRADO");
        }

        await contactoService.updateStatus(id, estatus as EstadoContacto);

        return res.status(200).json({
            success: true,
            message: "Estado actualizado correctamente"
        });
    } catch (error) {
        console.error("Error en contacto.updateStatus:", error);

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error actualizando estado"
        });
    }
};

/**
 * @swagger
 * /contacto/{id}:
 *   delete:
 *     summary: Eliminar un contacto
 *     description: Endpoint privado para administradores. Elimina permanentemente el registro.
 *     tags:
       - Contacto
 *     security:
       - bearerAuth: []
 *     parameters:
       - in: path
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
 *       500:
 *         description: Error interno
 */
export const deleteContacto = async (
    req: Request,
    res: Response
) => {
    try {
        const { id } = req.params;
        await contactoService.delete(id);

        return res.status(200).json({
            success: true,
            message: "Contacto eliminado correctamente"
        });
    } catch (error) {
        console.error("Error en contacto.delete:", error);

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error eliminando contacto"
        });
    }
};

