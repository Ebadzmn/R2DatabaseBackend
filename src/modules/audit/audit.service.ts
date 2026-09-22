import { AuditLog, AuditAction } from "./audit.model";
import { logger } from "../../utils/logger";
import { Types } from "mongoose";

interface LogAuditParams {
  adminId?: string | Types.ObjectId;
  action: AuditAction;
  resourceType: "STORAGE" | "MOVIE" | "UPLOAD" | "AUTH";
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  public static async record(params: LogAuditParams): Promise<void> {
    try {
      // Clean metadata of any sensitive keys before saving
      let cleanMetadata: Record<string, unknown> | undefined = undefined;
      if (params.metadata) {
        cleanMetadata = { ...params.metadata };
        delete cleanMetadata.secretAccessKey;
        delete cleanMetadata.accessKeyId;
        delete cleanMetadata.password;
        delete cleanMetadata.token;
      }

      await AuditLog.create({
        adminId: params.adminId ? new Types.ObjectId(params.adminId.toString()) : undefined,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: cleanMetadata,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent
      });
    } catch (err) {
      logger.error({ err }, "Failed to write audit log");
    }
  }
}
