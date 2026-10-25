import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { User, IUser } from "./user.model";
import { env } from "../../config/env";
import { UnauthorizedError, BadRequestError, NotFoundError, ForbiddenError } from "../../utils/errors";
import {
  RegisterInput,
  LoginInput,
  GuestLoginInput,
  UpgradeGuestInput,
  UpdateProfileInput
} from "./user.validation";

export interface AppUserJwtPayload {
  userId: string;
  email?: string;
  isGuest: boolean;
  role: "USER";
}

export interface UserAuthResponse {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    isGuest: boolean;
    status: string;
    blockReason?: string;
    blockedAt?: Date;
    createdAt?: Date;
  };
}

export class UserService {
  public static formatUser(user: IUser) {
    const rawStatus = (user.status || "ACTIVE").toString();
    const status = rawStatus.toLowerCase() === "blocked" ? "BLOCKED" : "ACTIVE";

    const fallbackName = user.isGuest
      ? "Guest Cinephile"
      : user.email
      ? user.email.split("@")[0]
      : "Cinephile";
    const displayName = user.displayName && user.displayName.trim().length > 0 ? user.displayName.trim() : fallbackName;

    return {
      id: user._id.toString(),
      displayName,
      email: user.email || "",
      avatarUrl: user.avatarUrl || "",
      isGuest: user.isGuest,
      status,
      blockReason: user.blockReason,
      blockedAt: user.blockedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt
    };
  }

  private static generateToken(user: IUser): string {
    const payload: AppUserJwtPayload = {
      userId: user._id.toString(),
      email: user.email,
      isGuest: user.isGuest,
      role: "USER"
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
    });
  }

  public static async register(input: RegisterInput): Promise<UserAuthResponse> {
    const existing = await User.findOne({ email: input.email.toLowerCase() });
    if (existing) {
      throw new BadRequestError("An account with this email already exists", "CONFLICT");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    const user = await User.create({
      displayName: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      isGuest: false,
      status: "ACTIVE",
      lastLoginAt: new Date()
    });

    const token = this.generateToken(user);

    return {
      token,
      user: this.formatUser(user)
    };
  }

  public static async login(input: LoginInput): Promise<UserAuthResponse> {
    const user = await User.findOne({ email: input.email.toLowerCase() });
    if (!user || user.isGuest) {
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.status === "BLOCKED") {
      throw new ForbiddenError(
        user.blockReason
          ? `Your account has been blocked: ${user.blockReason}`
          : "Your account has been blocked by an administrator"
      );
    }

    const isMatch = await user.comparePassword(input.password);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid email or password");
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = this.generateToken(user);

    return {
      token,
      user: this.formatUser(user)
    };
  }

  public static async guestLogin(input?: GuestLoginInput): Promise<UserAuthResponse> {
    let user: IUser | null = null;

    if (input?.deviceId) {
      user = await User.findOne({ deviceId: input.deviceId, isGuest: true });
    }

    if (user && user.status === "BLOCKED") {
      throw new ForbiddenError(
        user.blockReason
          ? `Your access has been blocked: ${user.blockReason}`
          : "Your access has been blocked by an administrator"
      );
    }

    if (!user) {
      user = await User.create({
        displayName: input?.displayName || "Guest Cinephile",
        isGuest: true,
        status: "ACTIVE",
        deviceId: input?.deviceId,
        lastLoginAt: new Date()
      });
    } else {
      user.lastLoginAt = new Date();
      await user.save();
    }

    const token = this.generateToken(user);

    return {
      token,
      user: this.formatUser(user)
    };
  }

  public static async upgradeGuest(
    guestUserId: string,
    input: UpgradeGuestInput
  ): Promise<UserAuthResponse> {
    const guestUser = await User.findById(guestUserId);
    if (!guestUser) {
      throw new NotFoundError("Guest account not found");
    }

    if (!guestUser.isGuest) {
      throw new BadRequestError("This account is already a registered account");
    }

    const emailExisting = await User.findOne({ email: input.email.toLowerCase() });
    if (emailExisting) {
      throw new BadRequestError("An account with this email already exists", "CONFLICT");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    guestUser.displayName = input.name;
    guestUser.email = input.email.toLowerCase();
    guestUser.passwordHash = passwordHash;
    guestUser.isGuest = false;
    guestUser.lastLoginAt = new Date();
    await guestUser.save();

    const token = this.generateToken(guestUser);

    return {
      token,
      user: this.formatUser(guestUser)
    };
  }

  public static async getProfile(userId: string) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return this.formatUser(user);
  }

  public static async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (input.displayName) user.displayName = input.displayName;
    if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;

    await user.save();
    return this.formatUser(user);
  }

  public static verifyUserToken(token: string): AppUserJwtPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AppUserJwtPayload;
      if (payload.role !== "USER") {
        throw new UnauthorizedError("Invalid user token");
      }
      return payload;
    } catch {
      throw new UnauthorizedError("Invalid or expired authentication token");
    }
  }
}
