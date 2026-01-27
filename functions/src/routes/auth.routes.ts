import { Router } from "express";
import { emailLogin, socialLogin } from "../controllers/users/auth.social.controller";

const router = Router();

router.post("/social", socialLogin);
router.post("/login", emailLogin);

export default router;
