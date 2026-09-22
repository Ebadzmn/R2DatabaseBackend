import { Schema, model, Document, Types } from "mongoose";

export type AuditAction =
  | "ADMIN_LOGIN"
  | "STORAGE_ADDED"
  | "STORAGE_UPDATED"
  | "STORAGE_DELETED"
  | "STORAGE_TESTED"
  | "STORAGE_RECALCULATED"
  | "STORAGE_ACTIVATED"
  | "STORAGE_DEACTIVATED"
  | "MOVIE_CREATED"
  | "MOVIE_UPDATED"
  | "MOVIE_DELETED"
  | "MOVIE_PROCESSED"
  | "MOVIE_REPROCESSED"
  | "UPLOAD_STARTED"
  | "UPLOAD_COMPLETED"
  | "UPLOAD_ABORTED"
  | "UPLOAD_FAILED";

export interface IAuditLog extends Document {
  adminId?: Types.ObjectId;
  action: AuditAction;
  resourceType: "STORAGE" | "MOVIE" | "UPLOAD" | "AUTH";
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });

export const AuditLog = model<IAuditLog>("AuditLog", auditLogSchema);
