import { Request, Response, NextFunction } from "express";
import { StorageService } from "./storage.service";
import { sendSuccess } from "../../utils/response";
import { AuditService } from "../audit/audit.service";

export class StorageController {
  public static async getAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storages = await StorageService.getAll();
      sendSuccess(res, storages);
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storage = await StorageService.getById(req.params.id);
      sendSuccess(res, storage);
    } catch (error) {
      next(error);
    }
  }

  public static async test(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await StorageService.testR2Credentials(req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_TESTED",
        resourceType: "STORAGE",
        metadata: {
          bucketName: req.body.bucketName,
          success: result.success,
          errorCode: result.errorCode
        },
        ipAddress: req.ip
      });

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
          errorCode: result.errorCode
        });
        return;
      }

      sendSuccess(res, result, "R2 connection successful");
    } catch (error) {
      next(error);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storage = await StorageService.create(req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_ADDED",
        resourceType: "STORAGE",
        resourceId: storage._id.toString(),
        metadata: {
          name: storage.name,
          bucketName: storage.bucketName,
          maxStorageBytes: storage.maxStorageBytes,
          priority: storage.priority
        },
        ipAddress: req.ip
      });

      sendSuccess(res, storage, "Storage account created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storage = await StorageService.update(req.params.id, req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_UPDATED",
        resourceType: "STORAGE",
        resourceId: storage._id.toString(),
        metadata: { name: storage.name },
        ipAddress: req.ip
      });

      sendSuccess(res, storage, "Storage account updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await StorageService.delete(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_DELETED",
        resourceType: "STORAGE",
        resourceId: req.params.id,
        ipAddress: req.ip
      });

      sendSuccess(res, null, "Storage account deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storage = await StorageService.activate(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_ACTIVATED",
        resourceType: "STORAGE",
        resourceId: storage._id.toString(),
        ipAddress: req.ip
      });

      sendSuccess(res, storage, "Storage account activated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const storage = await StorageService.deactivate(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_DEACTIVATED",
        resourceType: "STORAGE",
        resourceId: storage._id.toString(),
        ipAddress: req.ip
      });

      sendSuccess(res, storage, "Storage account deactivated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async recalculate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await StorageService.recalculate(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "STORAGE_RECALCULATED",
        resourceType: "STORAGE",
        resourceId: req.params.id,
        metadata: result,
        ipAddress: req.ip
      });

      sendSuccess(res, result, "Storage usage recalculated successfully");
    } catch (error) {
      next(error);
    }
  }
}
