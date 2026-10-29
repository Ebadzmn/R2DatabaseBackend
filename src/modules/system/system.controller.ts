import { Request, Response, NextFunction } from "express";
import { SystemService } from "./system.service";
import { sendSuccess } from "../../utils/response";
import { BadRequestError } from "../../utils/errors";

export class SystemController {
  public static async getStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const status = await SystemService.getSystemStatus();
      sendSuccess(res, status, "System status retrieved");
    } catch (error) {
      next(error);
    }
  }

  public static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).admin?.adminId || "admin";
      const { isMaintenance, title, message, estimatedDowntime, supportContact } = req.body;

      if (typeof isMaintenance !== "boolean") {
        throw new BadRequestError("isMaintenance boolean is required");
      }

      const updated = await SystemService.updateSystemStatus(adminId, {
        isMaintenance,
        title,
        message,
        estimatedDowntime,
        supportContact
      });

      sendSuccess(
        res,
        updated,
        `App maintenance mode ${isMaintenance ? "activated (App Offline)" : "deactivated (App Online)"}`
      );
    } catch (error) {
      next(error);
    }
  }

  public static async updateAppUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).admin?.adminId || "admin";
      const {
        isUpdateActive,
        isForceUpdate,
        latestVersion,
        minVersion,
        title,
        message,
        releaseNotes,
        downloadUrl
      } = req.body;

      const updated = await SystemService.updateAppUpdateConfig(adminId, {
        isUpdateActive,
        isForceUpdate,
        latestVersion,
        minVersion,
        title,
        message,
        releaseNotes,
        downloadUrl
      });

      sendSuccess(res, updated, "App update configuration updated successfully");
    } catch (error) {
      next(error);
    }
  }
}
