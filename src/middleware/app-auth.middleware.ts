import { Request, Response, NextFunction } from "express";
import { UserService, AppUserJwtPayload } from "../modules/app-auth/user.service";
import { User } from "../modules/app-auth/user.model";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";

declare global {
  namespace Express {
    interface Request {
      user?: AppUserJwtPayload;
    }
  }
}

export const authenticateUser = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Bearer authentication token is required"));
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = UserService.verifyUserToken(token);
    const user = await User.findById(payload.userId).select("status blockReason");
    if (!user) {
      return next(new UnauthorizedError("User no longer exists"));
    }
    if (user.status === "BLOCKED") {
      return next(
        new ForbiddenError(
          user.blockReason
            ? `Your account has been blocked: ${user.blockReason}`
            : "Your account has been blocked by an administrator"
        )
      );
    }
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
};

export const optionalAuthenticateUser = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = UserService.verifyUserToken(token);
    const user = await User.findById(payload.userId).select("status");
    if (user && user.status !== "BLOCKED") {
      req.user = payload;
    }
  } catch {
    // Optional token can silently fail
  }
  next();
};
