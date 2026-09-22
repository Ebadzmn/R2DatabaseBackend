import { Request, Response, NextFunction } from "express";
import { AuthService, JwtPayload } from "../modules/auth/auth.service";
import { UnauthorizedError } from "../utils/errors";

declare global {
  namespace Express {
    interface Request {
      admin?: JwtPayload;
    }
  }
}

export const authenticateAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Bearer token is required"));
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = AuthService.verifyToken(token);
    if (payload.role !== "ADMIN") {
      return next(new UnauthorizedError("Admin role required"));
    }
    req.admin = payload;
    next();
  } catch (err) {
    next(err);
  }
};
