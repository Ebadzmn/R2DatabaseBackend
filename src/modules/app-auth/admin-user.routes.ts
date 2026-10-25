import { Router } from "express";
import { AdminUserController } from "./admin-user.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import {
  queryAdminUsersSchema,
  updateUserStatusSchema,
  blockUserSchema
} from "./admin-user.validation";

const router = Router();

// Protect all admin user routes
router.use(authenticateAdmin);

router.get("/", validateRequest(queryAdminUsersSchema), AdminUserController.getAll);
router.get("/stats", AdminUserController.getStats);
router.get("/:id", AdminUserController.getById);
router.patch("/:id/status", validateRequest(updateUserStatusSchema), AdminUserController.updateStatus);
router.post("/:id/block", validateRequest(blockUserSchema), AdminUserController.block);
router.post("/:id/unblock", AdminUserController.unblock);
router.delete("/:id", AdminUserController.delete);

export default router;
