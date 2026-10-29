import { Schema, model, Document, Types } from "mongoose";

export interface IAppUpdateConfig {
  isUpdateActive: boolean;
  isForceUpdate: boolean;
  latestVersion: string;
  minVersion: string;
  title: string;
  message: string;
  releaseNotes: string[];
  downloadUrl: string;
}

export interface ISystemConfig extends Document {
  isMaintenance: boolean;
  title: string;
  message: string;
  estimatedDowntime?: string;
  supportContact?: string;
  appUpdate: IAppUpdateConfig;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const systemConfigSchema = new Schema<ISystemConfig>(
  {
    isMaintenance: { type: Boolean, default: false },
    title: { type: String, default: "Under Scheduled Maintenance" },
    message: {
      type: String,
      default:
        "CineCore is currently undergoing scheduled maintenance to upgrade streaming servers. Please check back shortly."
    },
    estimatedDowntime: { type: String, default: "" },
    supportContact: { type: String, default: "support@cinecore.io" },
    appUpdate: {
      isUpdateActive: { type: Boolean, default: false },
      isForceUpdate: { type: Boolean, default: false },
      latestVersion: { type: String, default: "1.0.0" },
      minVersion: { type: String, default: "1.0.0" },
      title: { type: String, default: "New Update Available!" },
      message: {
        type: String,
        default:
          "A new version of CineCore is available with performance improvements and new features."
      },
      releaseNotes: {
        type: [String],
        default: [
          "Performance optimizations and smoother playback",
          "Enhanced user interface and community features",
          "Bug fixes and security updates"
        ]
      },
      downloadUrl: { type: String, default: "https://cinecore.io/download/cinecore.apk" }
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" }
  },
  {
    timestamps: true
  }
);

export const SystemConfig = model<ISystemConfig>("SystemConfig", systemConfigSchema);
