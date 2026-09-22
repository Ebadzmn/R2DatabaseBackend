import { Schema, model, Document, Types } from "mongoose";

export type UploadStatus =
  | "INITIALIZED"
  | "UPLOADING"
  | "COMPLETING"
  | "UPLOADED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED";

export interface IUploadSession extends Document {
  _id: Types.ObjectId;
  movieId?: Types.ObjectId;
  storageAccountId: Types.ObjectId;
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadId?: string;
  status: UploadStatus;
  uploadedBytes: number;
  progress: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const uploadSessionSchema = new Schema<IUploadSession>(
  {
    movieId: { type: Schema.Types.ObjectId, ref: "Movie" },
    storageAccountId: { type: Schema.Types.ObjectId, ref: "StorageAccount", required: true },
    objectKey: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    uploadId: { type: String },
    status: {
      type: String,
      enum: [
        "INITIALIZED",
        "UPLOADING",
        "COMPLETING",
        "UPLOADED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "ABORTED"
      ],
      default: "INITIALIZED",
      required: true
    },
    uploadedBytes: { type: Number, default: 0 },
    progress: { type: Number, default: 0 },
    error: { type: String }
  },
  {
    timestamps: true
  }
);

uploadSessionSchema.index({ status: 1 });
uploadSessionSchema.index({ movieId: 1 });

export const UploadSession = model<IUploadSession>("UploadSession", uploadSessionSchema);
