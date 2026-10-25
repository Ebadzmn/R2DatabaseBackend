import { Request, Response, NextFunction } from "express";
import { AdminUserService } from "./admin-user.service";
import { sendSuccess } from "../../utils/response";

export class AdminUserController {
  public static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AdminUserService.getAll(req.query as any);
      sendSuccess(
        res,
        {
          users: result.items,
          stats: result.stats
        },
        "Users retrieved successfully",
        200,
        result.meta
      );
    } catch (error) {
      next(error);
    }
  }

  public static async getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await AdminUserService.getStats();
      sendSuccess(res, stats, "User statistics retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AdminUserService.getById(req.params.id);
      sendSuccess(res, user, "User details retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AdminUserService.updateStatus(
        req.params.id,
        req.body,
        req.admin?.adminId,
        req.ip
      );
      sendSuccess(
        res,
        user,
        `User ${user.status === "BLOCKED" ? "blocked" : "unblocked"} successfully`
      );
    } catch (error) {
      next(error);
    }
  }

  public static async block(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AdminUserService.updateStatus(
        req.params.id,
        { status: "BLOCKED", reason: req.body?.reason },
        req.admin?.adminId,
        req.ip
      );
      sendSuccess(res, user, "User blocked successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async unblock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AdminUserService.updateStatus(
        req.params.id,
        { status: "ACTIVE" },
        req.admin?.adminId,
        req.ip
      );
      sendSuccess(res, user, "User unblocked successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AdminUserService.delete(req.params.id, req.admin?.adminId, req.ip);
      sendSuccess(res, result, "User deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
