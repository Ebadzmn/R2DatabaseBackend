import mongoose from "mongoose";
import { S3Client, ListMultipartUploadsCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { EncryptionService } from "../services/encryption.service";
import { StorageAccount } from "../modules/storage/storage.model";

dotenv.config();

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  const storages = await StorageAccount.find();

  for (const storage of storages) {
    const creds = storage.getDecryptedCredentials();
    const client = new S3Client({
      region: "auto",
      endpoint: storage.endpoint,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
      forcePathStyle: true,
    });

    try {
      const list = await client.send(
        new ListMultipartUploadsCommand({ Bucket: storage.bucketName })
      );

      if (list.Uploads && list.Uploads.length > 0) {
        console.log(`Found ${list.Uploads.length} ongoing multipart uploads in ${storage.bucketName}. Cleaning up...`);
        for (const u of list.Uploads) {
          console.log(`Aborting: Key=${u.Key}, UploadId=${u.UploadId?.slice(0, 20)}...`);
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: storage.bucketName,
              Key: u.Key,
              UploadId: u.UploadId,
            })
          );
        }
        console.log(`Cleaned up all orphaned ongoing multipart uploads in ${storage.bucketName}!`);
      } else {
        console.log(`No orphaned multipart uploads found in ${storage.bucketName}.`);
      }

      // Reset any stale reserved bytes
      storage.reservedStorageBytes = 0;
      await storage.save();
      console.log(`Reset reservedStorageBytes to 0 for ${storage.name}.`);
    } catch (err: any) {
      console.error(`Error processing storage ${storage.name}:`, err.message);
    }
  }

  process.exit(0);
}

cleanup();
