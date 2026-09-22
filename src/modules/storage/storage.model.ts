import { Schema, model, Document, Types } from "mongoose";
import { EncryptionService } from "../../services/encryption.service";

export type StorageStatus = "ACTIVE" | "INACTIVE" | "FULL" | "ERROR";

export interface IStorageAccount extends Document {
  _id: Types.ObjectId;
  name: string;
  provider: "CLOUDFLARE_R2";
  accountId: string;
  bucketName: string;
  endpoint: string;
  publicUrl?: string; // e.g., https://pub-978e7a5dcf1145aeb50d511ce8af7c14.r2.dev or custom domain
  accessKeyId: string; // Encrypted in DB
  secretAccessKey: string; // Encrypted in DB
  maxStorageBytes: number;
  usedStorageBytes: number;
  reservedStorageBytes: number;
  priority: number;
  status: StorageStatus;
  lastCheckedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;

  getDecryptedCredentials(): { accessKeyId: string; secretAccessKey: string };
}

const storageAccountSchema = new Schema<IStorageAccount>(
  {
    name: { type: String, required: true, trim: true },
    provider: { type: String, enum: ["CLOUDFLARE_R2"], default: "CLOUDFLARE_R2", required: true },
    accountId: { type: String, required: true, trim: true },
    bucketName: { type: String, required: true, trim: true },
    endpoint: { type: String, required: true, trim: true },
    publicUrl: { type: String, trim: true },
    accessKeyId: { type: String, required: true },
    secretAccessKey: { type: String, required: true },
    maxStorageBytes: { type: Number, required: true, default: 10 * 1024 * 1024 * 1024 }, // Default 10GB
    usedStorageBytes: { type: Number, required: true, default: 0 },
    reservedStorageBytes: { type: Number, required: true, default: 0 },
    priority: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "FULL", "ERROR"],
      default: "ACTIVE",
      required: true
    },
    lastCheckedAt: { type: Date },
    lastError: { type: String }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        // Strip sensitive credentials in JSON output
        delete ret.secretAccessKey;
        delete ret.__v;
        // Provide safe accessKeyId preview
        try {
          const plainKey = EncryptionService.decrypt(ret.accessKeyId);
          ret.accessKeyIdPreview =
            plainKey.length > 8
              ? `${plainKey.substring(0, 4)}...${plainKey.substring(plainKey.length - 4)}`
              : "********";
        } catch {
          ret.accessKeyIdPreview = "********";
        }
        delete ret.accessKeyId;
        return ret;
      }
    }
  }
);

// Indexes for fast capacity lookup and sorting
storageAccountSchema.index({ status: 1, priority: 1, createdAt: 1 });

storageAccountSchema.methods.getDecryptedCredentials = function () {
  return {
    accessKeyId: EncryptionService.decrypt(this.accessKeyId),
    secretAccessKey: EncryptionService.decrypt(this.secretAccessKey)
  };
};

export const StorageAccount = model<IStorageAccount>("StorageAccount", storageAccountSchema);
