import { UploadService } from "../src/modules/upload/upload.service";
import { StorageAccount } from "../src/modules/storage/storage.model";
import { EncryptionService } from "../src/services/encryption.service";
import { R2Service } from "../src/modules/storage/r2.service";

describe("Upload Management & Lifecycle", () => {
  const GB = 1024 * 1024 * 1024;
  let storageAccountId: string;

  beforeEach(async () => {
    // Mock R2Service S3 SDK network calls so tests run isolated without live Cloudflare credentials
    jest.spyOn(R2Service, "initMultipartUpload").mockResolvedValue({
      uploadId: "mock_upload_id_123",
      key: "movies/test/source/file.mp4"
    });
    jest.spyOn(R2Service, "getPresignedPartUrl").mockResolvedValue("https://mock-r2-presigned-url.com/part");
    jest.spyOn(R2Service, "completeMultipartUpload").mockResolvedValue(undefined);
    jest.spyOn(R2Service, "abortMultipartUpload").mockResolvedValue(undefined);

    const encKey = EncryptionService.encrypt("access_key_test");
    const encSecret = EncryptionService.encrypt("secret_key_test");

    const storage = await StorageAccount.create({
      name: "R2-Primary",
      provider: "CLOUDFLARE_R2",
      accountId: "acc_test",
      bucketName: "bucket-test",
      endpoint: "https://acc_test.r2.cloudflarestorage.com",
      accessKeyId: encKey,
      secretAccessKey: encSecret,
      maxStorageBytes: 10 * GB,
      usedStorageBytes: 1 * GB,
      reservedStorageBytes: 0,
      priority: 1,
      status: "ACTIVE"
    });

    storageAccountId = storage._id.toString();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should initialize upload session, select storage, and reserve capacity", async () => {
    const fileSize = 2 * GB;
    const initResult = await UploadService.initUpload({
      fileName: "avengers.mp4",
      fileSize,
      contentType: "video/mp4",
      partCount: 5
    });

    expect(initResult.uploadSessionId).toBeDefined();
    expect(initResult.storageAccountId).toBe(storageAccountId);
    expect(initResult.status).toBe("INITIALIZED");

    // Verify storage reservation
    const storage = await StorageAccount.findById(storageAccountId);
    expect(storage?.reservedStorageBytes).toBe(fileSize);
  });

  it("should release reserved storage capacity when upload is aborted", async () => {
    const fileSize = 2 * GB;
    const initResult = await UploadService.initUpload({
      fileName: "matrix.mp4",
      fileSize,
      contentType: "video/mp4"
    });

    // Check storage is reserved
    let storage = await StorageAccount.findById(storageAccountId);
    expect(storage?.reservedStorageBytes).toBe(fileSize);

    // Abort session
    const aborted = await UploadService.abortUpload(initResult.uploadSessionId);
    expect(aborted.status).toBe("ABORTED");

    // Verify storage reservation released
    storage = await StorageAccount.findById(storageAccountId);
    expect(storage?.reservedStorageBytes).toBe(0);
  });
});
