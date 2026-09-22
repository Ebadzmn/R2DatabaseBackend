import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { sendSuccess } from "../../utils/response";
import { AuditService } from "../audit/audit.service";
import { AdminUser } from "./auth.model";
import { NotFoundError } from "../../utils/errors";

export class AuthController {
  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body);

      await AuditService.record({
        adminId: result.user._id?.toString(),
        action: "ADMIN_LOGIN",
        resourceType: "AUTH",
        resourceId: result.user._id?.toString(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent")
      });

      sendSuccess(res, result, "Login successful");
    } catch (error) {
      next(error);
    }
  }

  public static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendSuccess(res, null, "Logout successful");
    } catch (error) {
      next(error);
    }
  }

  public static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin?.adminId;
      const user = await AdminUser.findById(adminId).select("-passwordHash");
      if (!user) {
        throw new NotFoundError("Admin user not found");
      }
      sendSuccess(res, user);
    } catch (error) {
      next(error);
    }
  }
}
