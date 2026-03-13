import { Router } from "express";
import { registerOrLogin } from "../controllers/users/auth.social.controller";
import { logout } from "../controllers/users/auth.logout.controller";
import { authMiddleware } from "../utils/middlewares";
import { refreshToken } from "../controllers/users/auth.refresh.controller";

const router = Router();

/**
 * @swagger
 * /api/auth/register-or-login:
 *   post:
 *     summary: Registro o login combinado
 *     description: Registra o inicia sesión sin requerir token previo y retorna el token bearer de sesión
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
 *                   description: JWT de sesión para Authorization Bearer
 *                 bearerToken:
 *                   type: string
 *                   description: Alias explícito del token de sesión
 *                 tokenType:
 *                   type: string
 *                   example: "Bearer"
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
 *                   description: JWT de sesión para Authorization Bearer
 *                 bearerToken:
 *                   type: string
 *                   description: Alias explícito del token de sesión
 *                 tokenType:
 *                   type: string
 *                   example: "Bearer"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/register-or-login", registerOrLogin);

router.post("/logout", authMiddleware, logout);

router.post("/refresh", authMiddleware, refreshToken);

export default router;
