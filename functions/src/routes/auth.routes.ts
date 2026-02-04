import { Router } from "express";
import { emailLogin, registerOrLogin, socialLogin } from "../controllers/users/auth.social.controller";

const router = Router();

router.post("/social", socialLogin);
router.post("/login", emailLogin);
router.post("/register-or-login", registerOrLogin);

export default router;
