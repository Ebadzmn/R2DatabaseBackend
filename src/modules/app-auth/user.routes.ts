import { Router } from "express";
import { UserController } from "./user.controller";
import { validateRequest } from "../../middleware/validation.middleware";
import { authenticateUser } from "../../middleware/app-auth.middleware";
import {
  registerSchema,
  loginSchema,
  guestLoginSchema,
  upgradeGuestSchema,
  updateProfileSchema
} from "./user.validation";

export const appAuthRoutes = Router();
export const appUserRoutes = Router();

// Authentication Endpoints (/api/v1/auth/*)
appAuthRoutes.post("/register", validateRequest(registerSchema), UserController.register);
appAuthRoutes.post("/login", validateRequest(loginSchema), UserController.login);
appAuthRoutes.post("/guest", validateRequest(guestLoginSchema), UserController.guest);
appAuthRoutes.post(
  "/guest/upgrade",
  authenticateUser,
  validateRequest(upgradeGuestSchema),
  UserController.upgradeGuest
);
appAuthRoutes.get("/me", authenticateUser, UserController.getMe);
appAuthRoutes.post("/logout", authenticateUser, UserController.logout);

// User Profile Endpoints (/api/v1/users/*)
appUserRoutes.get("/me", authenticateUser, UserController.getMe);
appUserRoutes.patch("/me", authenticateUser, validateRequest(updateProfileSchema), UserController.updateMe);

export default appAuthRoutes;
