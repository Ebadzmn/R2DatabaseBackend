import { StorageAccount, IStorageAccount } from "./storage.model";
import { EncryptionService } from "../../services/encryption.service";
import { R2Service } from "./r2.service";
import { StorageManagerService } from "../../services/storage-manager.service";
import { CreateStorageInput, UpdateStorageInput, TestStorageInput } from "./storage.validation";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export class StorageService {
  /**
   * Retrieves all storage accounts with computed capacity metrics
   */
  public static async getAll(): Promise<any[]> {
    const accounts = await StorageAccount.find().sort({ priority: 1, createdAt: 1 });

    return accounts.map((acc) => {
      const plain = acc.toJSON();
      const availableBytes = Math.max(0, acc.maxStorageBytes - acc.usedStorageBytes - acc.reservedStorageBytes);
      const usagePercentage = acc.maxStorageBytes > 0
        ? Number(((acc.usedStorageBytes / acc.maxStorageBytes) * 100).toFixed(2))
        : 0;

      return {
        ...plain,
        availableStorageBytes: availableBytes,
        usagePercentage
      };
    });
  }

  /**
   * Retrieves a single storage account by ID
   */
  public static async getById(id: string): Promise<any> {
    const account = await StorageAccount.findById(id);
    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    const plain = account.toJSON();
    const availableBytes = Math.max(0, account.maxStorageBytes - account.usedStorageBytes - account.reservedStorageBytes);
    const usagePercentage = account.maxStorageBytes > 0
      ? Number(((account.usedStorageBytes / account.maxStorageBytes) * 100).toFixed(2))
      : 0;

    return {
      ...plain,
      availableStorageBytes: availableBytes,
      usagePercentage
    };
  }

  /**
   * Tests R2 credentials before saving
   */
  public static async testR2Credentials(input: TestStorageInput) {
    return R2Service.testConnection({
      accountId: input.accountId,
      bucketName: input.bucketName,
      endpoint: input.endpoint,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey
    });
  }

  /**
   * Creates a new storage account with encrypted credentials
   */
  public static async create(input: CreateStorageInput): Promise<IStorageAccount> {
    // Encrypt sensitive credentials
    const encryptedAccessKey = EncryptionService.encrypt(input.accessKeyId);
    const encryptedSecretKey = EncryptionService.encrypt(input.secretAccessKey);

    const account = await StorageAccount.create({
      name: input.name,
      provider: "CLOUDFLARE_R2",
      accountId: input.accountId,
      bucketName: input.bucketName,
      endpoint: input.endpoint,
      publicUrl: input.publicUrl,
      accessKeyId: encryptedAccessKey,
      secretAccessKey: encryptedSecretKey,
      maxStorageBytes: input.maxStorageBytes,
      priority: input.priority,
      status: input.status,
      usedStorageBytes: 0,
      reservedStorageBytes: 0
    });

    logger.info({ storageId: account._id, name: account.name }, "New R2 storage account added successfully");
    return account;
  }

  /**
   * Updates an existing storage account
   */
  public static async update(id: string, input: UpdateStorageInput): Promise<IStorageAccount> {
    const account = await StorageAccount.findById(id);
    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    if (input.name) account.name = input.name;
    if (input.publicUrl !== undefined) account.publicUrl = input.publicUrl;
    if (input.maxStorageBytes) account.maxStorageBytes = input.maxStorageBytes;
    if (input.priority) account.priority = input.priority;
    if (input.status) account.status = input.status;

    if (input.accessKeyId) {
      account.accessKeyId = EncryptionService.encrypt(input.accessKeyId);
    }
    if (input.secretAccessKey) {
      account.secretAccessKey = EncryptionService.encrypt(input.secretAccessKey);
    }

    await account.save();
    return account;
  }

  /**
   * Deletes a storage account
   */
  public static async delete(id: string): Promise<void> {
    const account = await StorageAccount.findById(id);
    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    if (account.usedStorageBytes > 0) {
      throw new BadRequestError(
        "Cannot delete storage account that contains stored movies or files. Please migrate or delete content first.",
        "INVALID_REQUEST"
      );
    }

    await StorageAccount.findByIdAndDelete(id);
  }

  /**
   * Activates a storage account
   */
  public static async activate(id: string): Promise<IStorageAccount> {
    const account = await StorageAccount.findById(id);
    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    account.status = "ACTIVE";
    await account.save();
    return account;
  }

  /**
   * Deactivates a storage account
   */
  public static async deactivate(id: string): Promise<IStorageAccount> {
    const account = await StorageAccount.findById(id);
    if (!account) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    account.status = "INACTIVE";
    await account.save();
    return account;
  }

  /**
   * Recalculates storage usage from actual R2 bucket
   */
  public static async recalculate(id: string) {
    return StorageManagerService.recalculateStorageUsage(id);
  }
}
