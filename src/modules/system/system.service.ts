import { SystemConfig, IAppUpdateConfig } from "./system.model";
import { redisConnection } from "../../config/redis";
import { logger } from "../../utils/logger";

const CACHE_KEY = "system:status";

const DEFAULT_APP_UPDATE: IAppUpdateConfig = {
  isUpdateActive: false,
  isForceUpdate: false,
  latestVersion: "1.0.0",
  minVersion: "1.0.0",
  title: "New Update Available!",
  message: "A new version of CineCore is available with performance improvements and new features.",
  releaseNotes: [
    "Performance optimizations and smoother playback",
    "Enhanced user interface and community features",
    "Bug fixes and security updates"
  ],
  downloadUrl: "https://cinecore.io/download/cinecore.apk"
};

export class SystemService {
  /**
   * Get current public system, maintenance & app update status
   */
  public static async getSystemStatus() {
    try {
      if (redisConnection.status === "ready" || redisConnection.status === "connect") {
        const cached = await redisConnection.get(CACHE_KEY);
        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (_) { }

    let config = await SystemConfig.findOne().sort({ updatedAt: -1 });
    if (!config) {
      config = await SystemConfig.create({
        isMaintenance: false,
        title: "Under Scheduled Maintenance",
        message:
          "CineCore is currently undergoing scheduled maintenance to upgrade streaming servers. Please check back shortly.",
        estimatedDowntime: "",
        supportContact: "support@cinecore.io",
        appUpdate: DEFAULT_APP_UPDATE
      });
    }

    const appUpdate = config.appUpdate || DEFAULT_APP_UPDATE;

    const payload = {
      isMaintenance: Boolean(config.isMaintenance),
      title: config.title || "Under Scheduled Maintenance",
      message:
        config.message ||
        "CineCore is currently undergoing scheduled maintenance to upgrade streaming servers. Please check back shortly.",
      estimatedDowntime: config.estimatedDowntime || "",
      supportContact: config.supportContact || "support@cinecore.io",
      appUpdate: {
        isUpdateActive: Boolean(appUpdate.isUpdateActive),
        isForceUpdate: Boolean(appUpdate.isForceUpdate),
        latestVersion: appUpdate.latestVersion || "1.0.0",
        minVersion: appUpdate.minVersion || "1.0.0",
        title: appUpdate.title || "New Update Available!",
        message:
          appUpdate.message ||
          "A new version of CineCore is available with performance improvements and new features.",
        releaseNotes:
          Array.isArray(appUpdate.releaseNotes) && appUpdate.releaseNotes.length > 0
            ? appUpdate.releaseNotes
            : DEFAULT_APP_UPDATE.releaseNotes,
        downloadUrl: appUpdate.downloadUrl || "https://cinecore.io/download/cinecore.apk"
      },
      updatedAt: config.updatedAt
    };

    try {
      if (redisConnection.status === "ready" || redisConnection.status === "connect") {
        await redisConnection.set(CACHE_KEY, JSON.stringify(payload), "EX", 30);
      }
    } catch (_) { }

    return payload;
  }

  /**
   * Update system maintenance status (Admin only)
   */
  public static async updateSystemStatus(
    adminId: string,
    data: {
      isMaintenance: boolean;
      title?: string;
      message?: string;
      estimatedDowntime?: string;
      supportContact?: string;
    }
  ) {
    let config = await SystemConfig.findOne().sort({ updatedAt: -1 });
    if (!config) {
      config = new SystemConfig();
    }

    config.isMaintenance = data.isMaintenance;
    if (data.title !== undefined) config.title = data.title;
    if (data.message !== undefined) config.message = data.message;
    if (data.estimatedDowntime !== undefined) config.estimatedDowntime = data.estimatedDowntime;
    if (data.supportContact !== undefined) config.supportContact = data.supportContact;
    config.updatedBy = adminId as any;

    await config.save();

    // Invalidate Redis cache
    try {
      if (redisConnection.status === "ready" || redisConnection.status === "connect") {
        await redisConnection.del(CACHE_KEY);
      }
    } catch (_) { }

    logger.info(
      `[System Control] Maintenance mode set to ${config.isMaintenance ? "ACTIVE (App Offline)" : "INACTIVE (App Online)"
      } by admin ${adminId}`
    );

    return this.getSystemStatus();
  }

  /**
   * Update app update configuration (Admin only)
   */
  public static async updateAppUpdateConfig(
    adminId: string,
    data: Partial<IAppUpdateConfig>
  ) {
    let config = await SystemConfig.findOne().sort({ updatedAt: -1 });
    if (!config) {
      config = new SystemConfig();
    }

    if (!config.appUpdate) {
      config.appUpdate = { ...DEFAULT_APP_UPDATE };
    }

    if (data.isUpdateActive !== undefined) config.appUpdate.isUpdateActive = Boolean(data.isUpdateActive);
    if (data.isForceUpdate !== undefined) config.appUpdate.isForceUpdate = Boolean(data.isForceUpdate);
    if (data.latestVersion !== undefined) config.appUpdate.latestVersion = data.latestVersion.trim();
    if (data.minVersion !== undefined) config.appUpdate.minVersion = data.minVersion.trim();
    if (data.title !== undefined) config.appUpdate.title = data.title.trim();
    if (data.message !== undefined) config.appUpdate.message = data.message.trim();
    if (data.downloadUrl !== undefined) config.appUpdate.downloadUrl = data.downloadUrl.trim();
    if (data.releaseNotes !== undefined) {
      config.appUpdate.releaseNotes = Array.isArray(data.releaseNotes)
        ? data.releaseNotes.filter((n) => typeof n === "string" && n.trim().length > 0)
        : [];
    }
    config.updatedBy = adminId as any;

    await config.save();

    // Invalidate Redis cache
    try {
      if (redisConnection.status === "ready" || redisConnection.status === "connect") {
        await redisConnection.del(CACHE_KEY);
      }
    } catch (_) {}

    logger.info(
      `[App Update Control] Update config saved (v${config.appUpdate.latestVersion}, Active: ${config.appUpdate.isUpdateActive}, Force: ${config.appUpdate.isForceUpdate}) by admin ${adminId}`
    );

    return this.getSystemStatus();
  }
}
