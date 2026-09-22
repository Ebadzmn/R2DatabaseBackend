import express, { Router } from "express";
import { UploadController } from "./upload.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import {
  initUploadSchema,
  completeUploadSchema,
  getPartUrlsSchema,
  abortUploadSchema
} from "./upload.validation";

const router = Router();

router.use(authenticateAdmin);

router.post("/init", validateRequest(initUploadSchema), UploadController.init);
router.get("/:id/part-urls", validateRequest(getPartUrlsSchema), UploadController.getPartUrls);
router.put(
  "/:id/part/:partNumber",
  express.raw({ limit: "50mb", type: "*/*" }),
  UploadController.uploadPart
);
router.put(
  "/:id/direct",
  express.raw({ limit: "100mb", type: "*/*" }),
  UploadController.uploadDirect
);
router.post("/:id/complete", validateRequest(completeUploadSchema), UploadController.complete);
router.post("/:id/abort", validateRequest(abortUploadSchema), UploadController.abort);
router.get("/:id", UploadController.getById);


export default router;
