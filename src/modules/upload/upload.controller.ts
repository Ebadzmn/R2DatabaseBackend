import { Request, Response, NextFunction } from "express";
import { UploadService } from "./upload.service";
import { sendSuccess } from "../../utils/response";
import { AuditService } from "../audit/audit.service";

export class UploadController {
  public static async init(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UploadService.initUpload(req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "UPLOAD_STARTED",
        resourceType: "UPLOAD",
        resourceId: result.uploadSessionId,
        metadata: {
          fileName: req.body.fileName,
          fileSize: req.body.fileSize,
          storageAccountId: result.storageAccountId
        },
        ipAddress: req.ip
      });

      sendSuccess(res, result, "Upload session initialized successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async getPartUrls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const startPart = Number(req.query.startPart) || 1;
      const count = Number(req.query.count) || 10;
      const partUrls = await UploadService.getPartUrls(req.params.id, startPart, count);
      sendSuccess(res, partUrls);
    } catch (error) {
      next(error);
    }
  }

  public static async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await UploadService.completeUpload(req.params.id, req.body.parts);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "UPLOAD_COMPLETED",
        resourceType: "UPLOAD",
        resourceId: session._id.toString(),
        metadata: {
          movieId: session.movieId?.toString(),
          fileSize: session.fileSize
        },
        ipAddress: req.ip
      });

      sendSuccess(res, session, "Upload completed successfully. Video processing queued.");
    } catch (error) {
      next(error);
    }
  }

  public static async abort(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await UploadService.abortUpload(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "UPLOAD_ABORTED",
        resourceType: "UPLOAD",
        resourceId: session._id.toString(),
        ipAddress: req.ip
      });

      sendSuccess(res, session, "Upload aborted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await UploadService.getById(req.params.id);
      sendSuccess(res, session);
    } catch (error) {
      next(error);
    }
  }

  public static async uploadPart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = req.params.id;
      const partNumber = Number(req.params.partNumber);
      if (!partNumber || partNumber < 1) {
        res.status(400).json({ success: false, message: "Invalid partNumber parameter" });
        return;
      }

      if (!req.body || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ success: false, message: "Binary chunk data required in request body" });
        return;
      }

      const result = await UploadService.uploadPart(sessionId, partNumber, req.body);
      res.setHeader("ETag", `"${result.etag}"`);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  public static async uploadDirect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = req.params.id;
      if (!req.body || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ success: false, message: "Binary file data required in request body" });
        return;
      }

      const contentType = (req.headers["content-type"] as string) || "video/mp4";
      const session = await UploadService.uploadDirect(sessionId, req.body, contentType);
      sendSuccess(res, session, "Upload completed successfully. Video processing queued.");
    } catch (error) {
      next(error);
    }
  }
}

