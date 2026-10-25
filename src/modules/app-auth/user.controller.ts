import { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service";
import { sendSuccess } from "../../utils/response";
import { UnauthorizedError } from "../../utils/errors";

export class UserController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.register(req.body);
      sendSuccess(res, result, "Account registered successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.login(req.body);
      sendSuccess(res, result, "Logged in successfully", 200);
    } catch (error) {
      next(error);
    }
  }

  public static async guest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.guestLogin(req.body);
      sendSuccess(res, result, "Guest session established", 200);
    } catch (error) {
      next(error);
    }
  }

  public static async upgradeGuest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError("Authentication required to upgrade account");
      }
      const result = await UserService.upgradeGuest(req.user.userId, req.body);
      sendSuccess(res, result, "Guest account successfully upgraded", 200);
    } catch (error) {
      next(error);
    }
  }

  public static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError("Authentication required");
      }
      const user = await UserService.getProfile(req.user.userId);
      sendSuccess(res, user, "User profile retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError("Authentication required");
      }
      const user = await UserService.updateProfile(req.user.userId, req.body);
      sendSuccess(res, user, "Profile updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendSuccess(res, { loggedOut: true }, "Logged out successfully");
    } catch (error) {
      next(error);
    }
  }
}
