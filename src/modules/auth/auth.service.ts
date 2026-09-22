import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { AdminUser, IAdminUser } from "./auth.model";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { LoginInput } from "./auth.validation";

export interface JwtPayload {
  adminId: string;
  email: string;
  role: "ADMIN";
}

export class AuthService {
  public static async login(input: LoginInput): Promise<{ token: string; user: Partial<IAdminUser> }> {
    const user = await AdminUser.findOne({ email: input.email.toLowerCase() });
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const isValid = await user.comparePassword(input.password);
    if (!isValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    user.lastLoginAt = new Date();
    await user.save();

    const payload: JwtPayload = {
      adminId: user._id.toString(),
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
    });

    return {
      token,
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLoginAt: user.lastLoginAt
      }
    };
  }

  public static async seedInitialAdmin(): Promise<void> {
    const count = await AdminUser.countDocuments();
    if (count === 0) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(env.INITIAL_ADMIN_PASSWORD, salt);

      await AdminUser.create({
        email: env.INITIAL_ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        name: env.INITIAL_ADMIN_NAME,
        role: "ADMIN"
      });

      logger.info({ email: env.INITIAL_ADMIN_EMAIL }, "Initial admin account created successfully");
    }
  }

  public static verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      throw new UnauthorizedError("Invalid or expired authentication token");
    }
  }
}
