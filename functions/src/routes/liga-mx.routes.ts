import { Router } from "express";
import * as queryController from "../controllers/liga-mx/liga-mx.query.controller";
import {
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  ligaMxDivisionQuerySchema,
  ligaMxMatchIdParamSchema,
  ligaMxPlayerIdParamSchema,
} from "../middleware/validators/liga-mx.validator";

const router = Router();

router.get("/contexto", queryController.getContext);
router.get(
  "/calendario",
  validateQuery(ligaMxDivisionQuerySchema),
  queryController.getCalendar,
);
router.get(
  "/clasificacion",
  validateQuery(ligaMxDivisionQuerySchema),
  queryController.getStandings,
);
router.get(
  "/plantilla",
  validateQuery(ligaMxDivisionQuerySchema),
  queryController.getRoster,
);
router.get(
  "/jugadores/:idAfiliado",
  validateParams(ligaMxPlayerIdParamSchema),
  queryController.getPlayer,
);
router.get(
  "/partidos/:idPartido",
  validateParams(ligaMxMatchIdParamSchema),
  queryController.getMatch,
);
router.get(
  "/partidos/:idPartido/detalle",
  validateParams(ligaMxMatchIdParamSchema),
  queryController.getMatchDetail,
);

export default router;