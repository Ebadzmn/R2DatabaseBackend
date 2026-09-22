import { Router } from "express";
import { StorageController } from "./storage.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import {
  createStorageSchema,
  updateStorageSchema,
  testStorageSchema
} from "./storage.validation";

const router = Router();

// All storage routes are protected by admin auth
router.use(authenticateAdmin);

router.get("/", StorageController.getAll);
router.post("/", validateRequest(createStorageSchema), StorageController.create);
router.post("/test", validateRequest(testStorageSchema), StorageController.test);
router.get("/:id", StorageController.getById);
router.patch("/:id", validateRequest(updateStorageSchema), StorageController.update);
router.delete("/:id", StorageController.delete);
router.post("/:id/recalculate", StorageController.recalculate);
router.post("/:id/activate", StorageController.activate);
router.post("/:id/deactivate", StorageController.deactivate);

export default router;
