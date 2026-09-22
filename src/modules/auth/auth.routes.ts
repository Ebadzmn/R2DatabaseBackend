import { Router } from "express";
import { AuthController } from "./auth.controller";
import { validateRequest } from "../../middleware/validation.middleware";
import { loginSchema } from "./auth.validation";
import { authenticateAdmin } from "../../middleware/auth.middleware";

const router = Router();

router.post("/login", validateRequest(loginSchema), AuthController.login);
router.post("/logout", authenticateAdmin, AuthController.logout);
router.get("/me", authenticateAdmin, AuthController.me);

export default router;
