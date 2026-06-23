import { Request, Response } from "express";
import contactoService from "../../services/contacto.service";

import { ApiError } from "../../lib/api/client";
import { sendContactConfirmationEmail, sendContactNotificationEmail } from "../../lib/brevo/client";

/**
 * @swagger
 * /contacto:
 *   post:
 *     summary: Crear una nueva solicitud de contacto
 *     description: |
       Endpoint público para que los usuarios envíen consultas, sugerencias o reportes.
       No requiere autenticación, pero si el usuario está logueado se asocia su UID.
       Envía email de confirmación al usuario y notificación al equipo de soporte.
 *     tags:
       - Contacto
 *     security:
       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *       application/json:
 *         schema:
 *           type: object
 *           required:
 *             - nombre
 *             - email
 *             - asunto
 *             - mensaje
 *           properties:
 *             nombre:
 *               type: string
 *               minLength: 1
 *               maxLength: 100
 *               example: "Juan Pérez"
 *               description: Nombre completo del remitente
 *             email:
 *               type: string
 *               format: email
 *               example: "juan@email.com"
 *               description: Email de contacto (recibirá confirmación)
 *             telefono:
 *               type: string
 *               maxLength: 20
 *               example: "4771234567"
 *               description: Teléfono opcional
 *             asunto:
 *               type: string
 *               minLength: 1
 *               maxLength: 150
 *               example: "Consulta sobre tallas"
 *               description: Asunto del mensaje
 *             mensaje:
 *               type: string
 *               minLength: 1
 *               maxLength: 5000
 *               example: "Hola, quisiera saber...
 *               description: Contenido del mensaje
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
export const create = async (
    req: Request,
    res: Response
) => {
    try {
        const {
            nombre,
            email,
            telefono,
            asunto,
            mensaje
        } = req.body;

        // Validación temprana con mensajes específicos
        const errores: string[] = [];
        if (!nombre?.trim()) errores.push("nombre");
        if (!email?.trim()) errores.push("email");
        if (!asunto?.trim()) errores.push("asunto");
        if (!mensaje?.trim()) errores.push("mensaje");

        if (errores.length > 0) {
            throw new ApiError(400, `Campos requeridos faltantes: ${errores.join(", ")}`);
        }

        // Validación de formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ApiError(400, "El formato del email no es válido");
        }
        const uid = req.user?.uid;

        const contacto = await contactoService.create(
            {
                nombre: nombre.trim(),
                email: email.trim().toLowerCase(),
                telefono: telefono?.trim(),
                asunto: asunto.trim(),
                mensaje: mensaje.trim()
            },
            uid
        );

        // Enviar emails en paralelo (no bloquear respuesta si fallan)
        try {
            await Promise.allSettled([
                sendContactNotificationEmail(contacto),
                sendContactConfirmationEmail(contacto.email, contacto.nombre)
            ]);
        } catch (emailError) {
            // Log pero no fallar la request principal
            console.error("Error enviando emails de contacto:", emailError);
        }

        return res.status(201).json({
            success: true,
            message: "Solicitud enviada correctamente",
            data: contacto
        });
    } catch (error) {
        console.error("Error en contacto.create:", error);

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error interno del servidor"
        });
    }
};