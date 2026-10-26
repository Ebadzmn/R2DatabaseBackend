import { Router } from "express";
import { CategoryController } from "./category.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import { createCategorySchema, updateCategorySchema } from "./category.validation";

// Admin Category Routes (Protected)
export const adminCategoryRouter = Router();

adminCategoryRouter.use(authenticateAdmin);

adminCategoryRouter.get("/", CategoryController.getAll);
adminCategoryRouter.get("/:id", CategoryController.getById);
adminCategoryRouter.post("/", validateRequest(createCategorySchema), CategoryController.create);
adminCategoryRouter.patch("/:id", validateRequest(updateCategorySchema), CategoryController.update);
adminCategoryRouter.delete("/:id", CategoryController.delete);

// Public Category Routes (Unauthenticated, for App and Website)
export const publicCategoryRouter = Router();

publicCategoryRouter.get("/", CategoryController.getPublic);
publicCategoryRouter.get("/:id", CategoryController.getById);

export default adminCategoryRouter;
