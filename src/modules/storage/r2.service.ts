import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  _Object
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IStorageAccount } from "./storage.model";
import { logger } from "../../utils/logger";
import { Readable } from "stream";

export interface R2Credentials {
  accountId: string;
  bucketName: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PartETag {
  PartNumber: number;
  ETag: string;
}

export class R2Service {
  /**
   * Dynamically instantiates an S3Client configured for Cloudflare R2
   */
  public static createClient(credentials: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }): S3Client {
    // Standard Cloudflare R2 endpoint format: https://<account_id>.r2.cloudflarestorage.com
    let endpoint = credentials.endpoint;
    if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
      endpoint = `https://${endpoint}`;
    }

    return new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey
      },
      forcePathStyle: true
    });
  }

  /**
   * Creates an S3Client directly from a stored StorageAccount document
   */
  public static createClientFromAccount(account: IStorageAccount): S3Client {
    const creds = account.getDecryptedCredentials();
    return this.createClient({
      endpoint: account.endpoint,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey
    });
  }

  /**
   * Tests connection & bucket access using the given credentials without persisting them
   */
  public static async testConnection(credentials: R2Credentials): Promise<{
    success: boolean;
    message: string;
    errorCode?: string;
  }> {
    const client = this.createClient(credentials);
    const testKey = `.probe-test-${Date.now()}.tmp`;

    try {
      // 1. Verify bucket existence and access
      await client.send(
        new HeadBucketCommand({
          Bucket: credentials.bucketName
        })
      );

      // 2. Verify write permission with a tiny probe object
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucketName,
          Key: testKey,
          Body: Buffer.from("probe"),
          ContentType: "text/plain"
        })
      );

      // 3. Clean up the probe object
      await client.send(
        new DeleteObjectCommand({
          Bucket: credentials.bucketName,
          Key: testKey
        })
      );

      return {
        success: true,
        message: "R2 connection and read/write permissions verified successfully"
      };
    } catch (error: any) {
      logger.error({ err: error?.message, bucket: credentials.bucketName }, "R2 connection test failed");

      let errorCode = "STORAGE_CONNECTION_FAILED";
      const message = error?.message || "Failed to connect to R2 bucket";

      if (error?.name === "NoSuchBucket" || error?.$metadata?.httpStatusCode === 404) {
        errorCode = "BUCKET_NOT_FOUND";
      } else if (error?.name === "InvalidAccessKeyId" || error?.$metadata?.httpStatusCode === 403) {
        errorCode = "INVALID_CREDENTIALS";
      }

      return {
        success: false,
        message,
        errorCode
      };
    }
  }

  /**
   * Initiates an S3 multipart upload for large files
   */
  public static async initMultipartUpload(
    account: IStorageAccount,
    key: string,
    contentType = "video/mp4"
  ): Promise<{ uploadId: string; key: string }> {
    const client = this.createClientFromAccount(account);
    const command = new CreateMultipartUploadCommand({
      Bucket: account.bucketName,
      Key: key,
      ContentType: contentType
    });

    const response = await client.send(command);
    if (!response.UploadId) {
      throw new Error("Failed to initialize multipart upload: no upload ID returned");
    }

    return {
      uploadId: response.UploadId,
      key
    };
  }

  /**
   * Generates a presigned URL for uploading a specific part
   */
  public static async getPresignedPartUrl(
    account: IStorageAccount,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 3600
  ): Promise<string> {
    const client = this.createClientFromAccount(account);
    const command = new UploadPartCommand({
      Bucket: account.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber
    });

    return getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Uploads a part buffer directly to Cloudflare R2 and returns its ETag
   */
  public static async uploadPart(
    account: IStorageAccount,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer
  ): Promise<string> {
    const client = this.createClientFromAccount(account);
    const command = new UploadPartCommand({
      Bucket: account.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body
    });

    const response = await client.send(command);
    const etag = response.ETag || "";
    return etag.replace(/^"|"$/g, "");
  }


  /**
   * Completes an S3 multipart upload
   */
  public static async completeMultipartUpload(
    account: IStorageAccount,
    key: string,
    uploadId: string,
    parts: PartETag[]
  ): Promise<void> {
    const client = this.createClientFromAccount(account);

    // Parts must be sorted by PartNumber ascending
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

    const command = new CompleteMultipartUploadCommand({
      Bucket: account.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((p) => ({
          PartNumber: p.PartNumber,
          ETag: p.ETag
        }))
      }
    });

    await client.send(command);
  }

  /**
   * Aborts an active multipart upload and cleans up temporary parts
   */
  public static async abortMultipartUpload(
    account: IStorageAccount,
    key: string,
    uploadId: string
  ): Promise<void> {
    const client = this.createClientFromAccount(account);
    const command = new AbortMultipartUploadCommand({
      Bucket: account.bucketName,
      Key: key,
      UploadId: uploadId
    });

    await client.send(command);
  }

  /**
   * Generates a presigned URL for direct single-file upload (PUT)
   */
  public static async getPresignedPutUrl(
    account: IStorageAccount,
    key: string,
    contentType: string,
    expiresIn = 3600
  ): Promise<string> {
    const client = this.createClientFromAccount(account);
    const command = new PutObjectCommand({
      Bucket: account.bucketName,
      Key: key,
      ContentType: contentType
    });

    return getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Generates a presigned URL for downloading / streaming a private file (GET)
   */
  public static async getPresignedGetUrl(
    account: IStorageAccount,
    key: string,
    expiresIn = 3600
  ): Promise<string> {
    const client = this.createClientFromAccount(account);
    const command = new GetObjectCommand({
      Bucket: account.bucketName,
      Key: key
    });

    return getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Uploads a Buffer or Stream directly to R2 (used for HLS files, playlists, thumbnails)
   */
  public static async putObject(
    account: IStorageAccount,
    key: string,
    body: Buffer | Uint8Array | Readable | string,
    contentType: string
  ): Promise<void> {
    const client = this.createClientFromAccount(account);
    const command = new PutObjectCommand({
      Bucket: account.bucketName,
      Key: key,
      Body: body as any,
      ContentType: contentType
    });

    await client.send(command);
  }

  /**
   * Gets an object stream from R2 along with metadata (ContentType, ContentLength)
   */
  public static async getObjectDetailed(
    account: IStorageAccount,
    key: string
  ): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    const client = this.createClientFromAccount(account);
    const command = new GetObjectCommand({
      Bucket: account.bucketName,
      Key: key
    });

    const response = await client.send(command);
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength
    };
  }

  /**
   * Gets an object stream from R2
   */
  public static async getObjectStream(
    account: IStorageAccount,
    key: string
  ): Promise<Readable> {
    const client = this.createClientFromAccount(account);
    const command = new GetObjectCommand({
      Bucket: account.bucketName,
      Key: key
    });

    const response = await client.send(command);
    return response.Body as Readable;
  }

  /**
   * Deletes a single object from R2
   */
  public static async deleteObject(account: IStorageAccount, key: string): Promise<void> {
    const client = this.createClientFromAccount(account);
    const command = new DeleteObjectCommand({
      Bucket: account.bucketName,
      Key: key
    });

    await client.send(command);
  }

  /**
   * Deletes all objects with a given prefix (e.g., an entire movie's HLS directory)
   */
  public static async deleteDirectory(
    account: IStorageAccount,
    prefix: string
  ): Promise<{ deletedCount: number; freedBytes: number }> {
    const client = this.createClientFromAccount(account);
    let continuationToken: string | undefined = undefined;
    let deletedCount = 0;
    let freedBytes = 0;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: account.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });

      const listResponse: ListObjectsV2CommandOutput = await client.send(listCommand);
      const objects = listResponse.Contents || [];

      if (objects.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: account.bucketName,
          Delete: {
            Objects: objects.filter((o): o is _Object & { Key: string } => !!o.Key).map((obj) => ({ Key: obj.Key }))
          }
        });

        await client.send(deleteCommand);
        deletedCount += objects.length;
        freedBytes += objects.reduce((sum: number, obj: _Object) => sum + (obj.Size || 0), 0);
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return { deletedCount, freedBytes };
  }

  /**
   * Lists all objects and calculates actual total size stored in R2 bucket
   */
  public static async calculateActualUsage(
    account: IStorageAccount
  ): Promise<{ totalBytes: number; objectCount: number }> {
    const client = this.createClientFromAccount(account);
    let continuationToken: string | undefined = undefined;
    let totalBytes = 0;
    let objectCount = 0;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: account.bucketName,
        ContinuationToken: continuationToken
      });

      const listResponse: ListObjectsV2CommandOutput = await client.send(listCommand);
      const contents = listResponse.Contents || [];

      for (const item of contents) {
        totalBytes += item.Size || 0;
        objectCount++;
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return { totalBytes, objectCount };
  }
}
