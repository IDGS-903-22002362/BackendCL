import { Router } from "express";
import { registerOrLogin } from "../controllers/users/auth.social.controller";
import { logout } from "../controllers/users/auth.logout.controller";
import { authMiddleware } from "../utils/middlewares";
import { refreshToken } from "../controllers/users/auth.refresh.controller";
import { requestVerificationCode, verifyAndLogin } from "../controllers/users/auth.otp.controller";

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


/**
 * @swagger
 * /api/auth/request-verification-code:
 *   post:
 *     summary: Solicitar código de verificación por correo
 *     description: Genera un código OTP de 6 dígitos válido por 10 minutos y lo envía al correo del usuario registrado
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "usuario@ejemplo.com"
 *     responses:
 *       200:
 *         description: Código enviado exitosamente
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
 *                   example: "Código de verificación enviado a tu correo electrónico"
 *                 expiresIn:
 *                   type: integer
 *                   description: Minutos hasta que el código expira
 *                   example: 10
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       404:
 *         description: No existe una cuenta con ese correo
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
 *                   example: "No existe una cuenta con este correo electrónico"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/request-verification-code", requestVerificationCode);

/**
 * @swagger
 * /api/auth/verify-and-login:
 *   post:
 *     summary: Verificar código OTP e iniciar sesión
 *     description: Valida el código OTP enviado al correo y, si es correcto, retorna un JWT de sesión válido por 7 días
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - verificationCode
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "usuario@ejemplo.com"
 *               verificationCode:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "483921"
 *     responses:
 *       200:
 *         description: Inicio de sesión exitoso
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
 *                   example: "Inicio de sesión exitoso"
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: JWT de sesión para Authorization Bearer (expira en 7 días)
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         description: Código inválido, expirado o demasiados intentos fallidos
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
 *                   example: "Código incorrecto. Te quedan 2 intentos"
 *                 remainingAttempts:
 *                   type: integer
 *                   description: Intentos restantes antes de invalidar el código (máx. 3)
 *                   example: 2
 *       404:
 *         description: Usuario no encontrado
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
 *                   example: "Usuario no encontrado"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/verify-and-login", verifyAndLogin);

export default router;
