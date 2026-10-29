import { Router } from "express";
import { SystemController } from "./system.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";

export const publicSystemRouter = Router();
publicSystemRouter.get("/status", SystemController.getStatus);

export const adminSystemRouter = Router();
adminSystemRouter.use(authenticateAdmin);
adminSystemRouter.get("/status", SystemController.getStatus);
adminSystemRouter.put("/status", SystemController.updateStatus);
adminSystemRouter.put("/app-update", SystemController.updateAppUpdate);
