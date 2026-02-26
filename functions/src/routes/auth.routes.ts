import { Router } from "express";
import {
  registerOrLogin,
} from "../controllers/users/auth.social.controller";

const router = Router();


/**
 * @swagger
 * /api/auth/register-or-login:
 *   post:
 *     summary: Registro o login combinado
 *     description: Endpoint que registra un nuevo usuario si no existe o realiza login si ya está registrado
 *     tags: [Authentication]
 *     requestBody: 
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - nombre
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               nombre:
 *                 type: string
 *     responses:
 *       200:
 *         description: Operación exitosa (login)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Login exitoso"
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       201:
 *         description: Usuario registrado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Usuario registrado exitosamente"
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/register-or-login", registerOrLogin);

export default router;
