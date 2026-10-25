import { FilterQuery, Types } from "mongoose";
import { User, IUser } from "./user.model";
import { UserService } from "./user.service";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { AuditService } from "../audit/audit.service";
import { QueryAdminUsersInput, UpdateUserStatusInput } from "./admin-user.validation";

export class AdminUserService {
  public static async getAll(query: QueryAdminUsersInput) {
    const {
      page = 1,
      limit = 20,
      search,
      status = "ALL",
      type = "ALL",
      sortBy = "createdAt",
      sortOrder = "desc"
    } = query;

    const filter: FilterQuery<IUser> = {};

    if (search && search.trim().length > 0) {
      const trimmed = search.trim();
      filter.$or = [
        { displayName: { $regex: trimmed, $options: "i" } },
        { email: { $regex: trimmed, $options: "i" } },
        { deviceId: { $regex: trimmed, $options: "i" } }
      ];
    }

    if (status === "ACTIVE") {
      filter.$or = filter.$or
        ? [{ $and: [{ $or: filter.$or }, { status: { $in: ["ACTIVE", "active", null] } }] }]
        : [{ status: { $in: ["ACTIVE", "active", null] } }, { status: { $exists: false } }];
    } else if (status === "BLOCKED") {
      filter.status = { $in: ["BLOCKED", "blocked"] };
    }

    if (type === "REGISTERED") {
      filter.isGuest = { $ne: true };
    } else if (type === "GUEST") {
      filter.isGuest = true;
    }

    const sortOptions: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === "asc" ? 1 : -1
    };

    const skip = (page - 1) * limit;

    const [total, items, stats] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).sort(sortOptions).skip(skip).limit(limit).lean(),
      this.getStats()
    ]);

    const formattedItems = items.map((u) => UserService.formatUser(u as unknown as IUser));

    return {
      items: formattedItems,
      stats,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  public static async getStats() {
    const [totalUsers, activeUsers, blockedUsers, guestUsers, registeredUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({
        $or: [{ status: { $in: ["ACTIVE", "active", null] } }, { status: { $exists: false } }]
      }),
      User.countDocuments({ status: { $in: ["BLOCKED", "blocked"] } }),
      User.countDocuments({ isGuest: true }),
      User.countDocuments({ isGuest: { $ne: true } })
    ]);

    return {
      totalUsers,
      activeUsers,
      blockedUsers,
      guestUsers,
      registeredUsers
    };
  }

  public static async getById(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user identifier format");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return UserService.formatUser(user);
  }

  public static async updateStatus(
    userId: string,
    input: UpdateUserStatusInput,
    adminId?: string,
    ipAddress?: string
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user identifier format");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const prevStatus = user.status;
    user.status = input.status;

    if (input.status === "BLOCKED") {
      user.blockReason = input.reason || "Administrative block";
      user.blockedAt = new Date();
    } else {
      user.blockReason = undefined;
      user.blockedAt = undefined;
    }

    await user.save();

    const action = input.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UNBLOCKED";

    await AuditService.record({
      adminId,
      action,
      resourceType: "USER",
      resourceId: user._id.toString(),
      metadata: {
        previousStatus: prevStatus,
        newStatus: user.status,
        reason: user.blockReason,
        displayName: user.displayName,
        email: user.email,
        isGuest: user.isGuest
      },
      ipAddress
    });

    return UserService.formatUser(user);
  }

  public static async delete(userId: string, adminId?: string, ipAddress?: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user identifier format");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    await User.findByIdAndDelete(userId);

    await AuditService.record({
      adminId,
      action: "USER_DELETED",
      resourceType: "USER",
      resourceId: userId,
      metadata: {
        displayName: user.displayName,
        email: user.email,
        isGuest: user.isGuest
      },
      ipAddress
    });

    return { deleted: true, id: userId };
  }
}
