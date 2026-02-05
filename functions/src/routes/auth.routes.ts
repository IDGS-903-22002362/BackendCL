import { Router } from "express";
import {
  emailLogin,
  registerOrLogin,
  socialLogin,
} from "../controllers/users/auth.social.controller";

const router = Router();

/**
 * @swagger
 * /api/auth/social:
 *   post:
 *     summary: Autenticación social (Google/Apple)
 *     description: Endpoint para autenticación mediante providers sociales (Google o Apple)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *               - provider
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Token de ID del provider social
 *               provider:
 *                 type: string
 *                 enum: [google, apple]
 *                 description: Proveedor de autenticación
 *     responses:
 *       200:
 *         description: Autenticación exitosa
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: Token JWT de Firebase Auth
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         description: Token inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/social", socialLogin);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Autenticación con email y contraseña
 *     description: Endpoint para login tradicional con email y contraseña
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
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: usuario@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         description: Credenciales inválidas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Email o contraseña incorrectos"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/login", emailLogin);

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
