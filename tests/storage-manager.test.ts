import { StorageAccount } from "../src/modules/storage/storage.model";
import { StorageManagerService } from "../src/services/storage-manager.service";
import { EncryptionService } from "../src/services/encryption.service";
import { StorageCapacityExceededError } from "../src/utils/errors";

describe("StorageManagerService", () => {
  const GB = 1024 * 1024 * 1024;

  beforeEach(async () => {
    const encKey = EncryptionService.encrypt("test_key");
    const encSecret = EncryptionService.encrypt("test_secret");

    // Setup R2-01: Limit 10 GB, Used 8 GB (Free: 2 GB)
    await StorageAccount.create({
      name: "R2-01",
      provider: "CLOUDFLARE_R2",
      accountId: "acc_1",
      bucketName: "bucket-01",
      endpoint: "https://acc_1.r2.cloudflarestorage.com",
      accessKeyId: encKey,
      secretAccessKey: encSecret,
      maxStorageBytes: 10 * GB,
      usedStorageBytes: 8 * GB,
      reservedStorageBytes: 0,
      priority: 1,
      status: "ACTIVE"
    });

    // Setup R2-02: Limit 10 GB, Used 2 GB (Free: 8 GB)
    await StorageAccount.create({
      name: "R2-02",
      provider: "CLOUDFLARE_R2",
      accountId: "acc_2",
      bucketName: "bucket-02",
      endpoint: "https://acc_2.r2.cloudflarestorage.com",
      accessKeyId: encKey,
      secretAccessKey: encSecret,
      maxStorageBytes: 10 * GB,
      usedStorageBytes: 2 * GB,
      reservedStorageBytes: 0,
      priority: 2,
      status: "ACTIVE"
    });
  });

  it("should select R2-01 when movie fits within R2-01 remaining capacity (1 GB movie)", async () => {
    const selected = await StorageManagerService.selectStorage(1 * GB);
    expect(selected.name).toBe("R2-01");
  });

  it("should automatically rotate to R2-02 when movie exceeds R2-01 capacity (3 GB movie)", async () => {
    // 8 GB used + 3 GB movie = 11 GB > 10 GB limit for R2-01 -> selects R2-02
    const selected = await StorageManagerService.selectStorage(3 * GB);
    expect(selected.name).toBe("R2-02");
  });

  it("should throw StorageCapacityExceededError when movie exceeds all available storage (9 GB movie)", async () => {
    // R2-01 has 2GB free, R2-02 has 8GB free. A 9GB movie cannot fit in either.
    await expect(StorageManagerService.selectStorage(9 * GB)).rejects.toThrow(
      StorageCapacityExceededError
    );
  });

  it("should atomically reserve storage and prevent concurrent over-allocation", async () => {
    // R2-01 has 2 GB remaining.
    // Try to reserve 1.5 GB on R2-01
    const r2_01 = await StorageAccount.findOne({ name: "R2-01" });
    expect(r2_01).not.toBeNull();

    const reserved = await StorageManagerService.reserveStorage(r2_01!._id, 1.5 * GB);
    expect(reserved.reservedStorageBytes).toBe(1.5 * GB);

    // Now R2-01 only has 0.5 GB available.
    // A second attempt to reserve 1.0 GB on R2-01 must fail
    await expect(
      StorageManagerService.reserveStorage(r2_01!._id, 1.0 * GB)
    ).rejects.toThrow(StorageCapacityExceededError);
  });

  it("should commit storage and update status to FULL when limit is reached", async () => {
    const r2_01 = await StorageAccount.findOne({ name: "R2-01" });
    await StorageManagerService.reserveStorage(r2_01!._id, 2 * GB);

    // Commit 2 GB upload: used becomes 8 + 2 = 10 GB
    const committed = await StorageManagerService.commitStorage(r2_01!._id, 2 * GB, 2 * GB);
    expect(committed.usedStorageBytes).toBe(10 * GB);
    expect(committed.reservedStorageBytes).toBe(0);
    expect(committed.status).toBe("FULL");
  });

  it("should release reserved storage on upload failure or abort", async () => {
    const r2_01 = await StorageAccount.findOne({ name: "R2-01" });
    await StorageManagerService.reserveStorage(r2_01!._id, 1 * GB);

    const released = await StorageManagerService.releaseStorage(r2_01!._id, 1 * GB);
    expect(released?.reservedStorageBytes).toBe(0);
  });
});
