import { Router } from "express";
import {
  acknowledge,
  getDetails,
  getGanadoresEspecial,
  getMisBeneficios,
  getPendingPlay,
  play,
} from "../controllers/minijuegos/minijuego.controller";
import {
  validateParams,
  verifyRole,
} from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";
import { minijuegoPlayParamsSchema } from "../middleware/validators/minijuego.validator";
import { RolUsuario } from "../models/usuario.model";
import { authMiddleware } from "../utils/middlewares";

const MINIJUEGO_STAFF_ROLES = [
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
  RolUsuario.EMPLEADO_CLUB,
];

const router = Router();

router.get("/me/beneficios", authMiddleware, getMisBeneficios);

router.get(
  "/:id/pending-play",
  authMiddleware,
  validateParams(idParamSchema),
  getPendingPlay,
);

router.post(
  "/:id/play",
  authMiddleware,
  validateParams(idParamSchema),
  play,
);

router.post(
  "/:id/plays/:playId/ack",
  authMiddleware,
  validateParams(minijuegoPlayParamsSchema),
  acknowledge,
);

router.get(
  "/:id/ganadores-especial",
  authMiddleware,
  verifyRole(MINIJUEGO_STAFF_ROLES),
  validateParams(idParamSchema),
  getGanadoresEspecial,
);

router.get("/:id", authMiddleware, validateParams(idParamSchema), getDetails);

export default router;
