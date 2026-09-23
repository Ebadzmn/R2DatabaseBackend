import { Types } from "mongoose";
import { StorageAccount, IStorageAccount } from "../modules/storage/storage.model";
import { R2Service } from "../modules/storage/r2.service";
import { StorageCapacityExceededError, NotFoundError } from "../utils/errors";
import { logger } from "../utils/logger";

export class StorageManagerService {
  /**
   * Finds an ACTIVE storage account that has sufficient available capacity for the specified fileSize.
   * Accounts are ordered by priority ASC, createdAt ASC.
   */
  public static async selectStorage(fileSize: number): Promise<IStorageAccount> {
    const activeAccounts = await StorageAccount.find({
      status: "ACTIVE"
    }).sort({ priority: 1, createdAt: 1 });

    for (const account of activeAccounts) {
      const available = account.maxStorageBytes - account.usedStorageBytes - account.reservedStorageBytes;
      if (available >= fileSize) {
        return account;
      }
    }

    throw new StorageCapacityExceededError(
      `No active R2 storage account has enough free capacity for ${fileSize} bytes (${(
        fileSize /
        (1024 * 1024 * 1024)
      ).toFixed(2)} GB). Please add or expand an R2 storage account.`
    );
  }

  /**
   * Atomically reserves storage capacity to protect against concurrent upload race conditions.
   * Returns the updated storage account.
   */
  public static async reserveStorage(
    storageId: string | Types.ObjectId,
    fileSize: number
  ): Promise<IStorageAccount> {
    const objectId = typeof storageId === "string" ? new Types.ObjectId(storageId) : storageId;

    // Concurrency-safe atomic reservation:
    // Only increment reservedStorageBytes if (maxStorageBytes - (usedStorageBytes + reservedStorageBytes + fileSize)) >= 0
    const updated = await StorageAccount.findOneAndUpdate(
      {
        _id: objectId,
        status: "ACTIVE",
        $expr: {
          $gte: [
            {
              $subtract: [
                "$maxStorageBytes",
                { $add: ["$usedStorageBytes", "$reservedStorageBytes", fileSize] }
              ]
            },
            0
          ]
        }
      },
      {
        $inc: { reservedStorageBytes: fileSize }
      },
      { new: true }
    );

    if (!updated) {
      // Check if account exists
      const account = await StorageAccount.findById(objectId);
      if (!account) {
        throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
      }
      throw new StorageCapacityExceededError(
        `Failed to reserve ${fileSize} bytes on storage '${account.name}'. Storage limit exceeded or concurrent upload conflict.`
      );
    }

    logger.info(
      {
        storageId: updated._id,
        name: updated.name,
        reservedBytes: updated.reservedStorageBytes,
        usedBytes: updated.usedStorageBytes,
        maxBytes: updated.maxStorageBytes
      },
      "Storage reserved successfully"
    );

    return updated;
  }

  /**
   * Automatically selects and reserves storage in one atomic transaction/workflow,
   * or reserves on a specific requested storage account.
   */
  public static async selectAndReserveStorage(
    fileSize: number,
    preferredStorageId?: string
  ): Promise<IStorageAccount> {
    if (preferredStorageId) {
      const specificAccount = await StorageAccount.findById(preferredStorageId);
      if (!specificAccount) {
        throw new NotFoundError("Selected storage account not found", "STORAGE_NOT_FOUND");
      }
      if (specificAccount.status !== "ACTIVE") {
        throw new StorageCapacityExceededError(`Selected storage account "${specificAccount.name}" is not ACTIVE.`);
      }
      return await this.reserveStorage(specificAccount._id, fileSize);
    }

    const candidateAccounts = await StorageAccount.find({
      status: "ACTIVE"
    }).sort({ priority: 1, createdAt: 1 });

    if (candidateAccounts.length === 0) {
      throw new StorageCapacityExceededError(
        "No active R2 storage accounts found. Please add and activate an R2 storage account in the admin dashboard."
      );
    }

    for (const account of candidateAccounts) {
      try {
        const reserved = await this.reserveStorage(account._id, fileSize);
        return reserved;
      } catch (err: any) {
        if (err instanceof StorageCapacityExceededError) {
          logger.warn(
            { storageId: account._id, name: account.name },
            "Storage candidate full or exceeded during reservation, rotating to next storage account"
          );
          continue;
        }
        throw err;
      }
    }

    throw new StorageCapacityExceededError(
      `All active storage accounts have reached capacity for the requested upload (${(
        fileSize /
        (1024 * 1024 * 1024)
      ).toFixed(2)} GB).`
    );
  }

  /**
   * Releases previously reserved storage capacity (e.g. if upload fails or is aborted)
   */
  public static async releaseStorage(
    storageId: string | Types.ObjectId,
    reservedSize: number
  ): Promise<IStorageAccount | null> {
    const objectId = typeof storageId === "string" ? new Types.ObjectId(storageId) : storageId;

    return StorageAccount.findOneAndUpdate(
      { _id: objectId },
      [
        {
          $set: {
            reservedStorageBytes: {
              $max: [0, { $subtract: ["$reservedStorageBytes", reservedSize] }]
            }
          }
        }
      ],
      { new: true }
    );
  }

  /**
   * Commits the upload: converts reserved capacity into permanent usedStorageBytes
   */
  public static async commitStorage(
    storageId: string | Types.ObjectId,
    reservedSize: number,
    actualSize: number
  ): Promise<IStorageAccount> {
    const objectId = typeof storageId === "string" ? new Types.ObjectId(storageId) : storageId;

    const account = await StorageAccount.findOneAndUpdate(
      { _id: objectId },
      [
        {
          $set: {
            reservedStorageBytes: {
              $max: [0, { $subtract: ["$reservedStorageBytes", reservedSize] }]
            },
            usedStorageBytes: {
              $add: ["$usedStorageBytes", actualSize]
            }
          }
        }
      ],
      { new: true }
    );

    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    // Check if account has reached capacity and update status to FULL if needed
    if (account.usedStorageBytes >= account.maxStorageBytes) {
      account.status = "FULL";
      await account.save();
      logger.warn(
        { storageId: account._id, name: account.name },
        "Storage account reached maximum capacity. Status set to FULL."
      );
    }

    return account;
  }

  /**
   * Queries actual Cloudflare R2 bucket usage and synchronizes MongoDB record
   */
  public static async recalculateStorageUsage(
    storageId: string | Types.ObjectId
  ): Promise<{ usedStorageBytes: number; objectCount: number; status: string }> {
    const objectId = typeof storageId === "string" ? new Types.ObjectId(storageId) : storageId;
    const account = await StorageAccount.findById(objectId);

    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    try {
      const { totalBytes, objectCount } = await R2Service.calculateActualUsage(account);

      account.usedStorageBytes = totalBytes;
      account.lastCheckedAt = new Date();
      account.lastError = undefined;

      // Update status if full or restored
      if (account.usedStorageBytes >= account.maxStorageBytes) {
        account.status = "FULL";
      } else if (account.status === "FULL" && account.usedStorageBytes < account.maxStorageBytes) {
        account.status = "ACTIVE";
      }

      await account.save();

      logger.info(
        {
          storageId: account._id,
          name: account.name,
          usedStorageBytes: totalBytes,
          objectCount,
          status: account.status
        },
        "Storage usage recalculated and synchronized successfully"
      );

      return {
        usedStorageBytes: totalBytes,
        objectCount,
        status: account.status
      };
    } catch (error: any) {
      account.lastError = error?.message || "Failed to recalculate R2 usage";
      account.status = "ERROR";
      await account.save();
      throw error;
    }
  }
}
