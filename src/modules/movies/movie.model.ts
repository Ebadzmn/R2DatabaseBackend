import { Schema, model, Document, Types } from "mongoose";

export type MovieStatus = "DRAFT" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
export type MovieType = "MOVIE" | "SERIES";

export interface IMovie extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  type: MovieType;
  releaseYear?: number;
  genres: string[];
  duration?: number; // In seconds
  sourceStorageId?: Types.ObjectId;
  hlsStorageId?: Types.ObjectId;
  hlsMasterKey?: string;
  sourceObjectKey?: string;
  sourceUrl?: string;
  fileSize?: number;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  status: MovieStatus;
  processingProgress?: number;
  processingError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const movieSchema = new Schema<IMovie>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    poster: { type: String, trim: true },
    backdrop: { type: String, trim: true },
    type: { type: String, enum: ["MOVIE", "SERIES"], default: "MOVIE", required: true },
    releaseYear: { type: Number },
    genres: [{ type: String, trim: true }],
    duration: { type: Number },
    sourceStorageId: { type: Schema.Types.ObjectId, ref: "StorageAccount" },
    hlsStorageId: { type: Schema.Types.ObjectId, ref: "StorageAccount" },
    hlsMasterKey: { type: String },
    sourceObjectKey: { type: String },
    sourceUrl: { type: String },
    fileSize: { type: Number },
    videoCodec: { type: String },
    audioCodec: { type: String },
    resolution: { type: String },
    status: {
      type: String,
      enum: ["DRAFT", "UPLOADING", "PROCESSING", "READY", "FAILED"],
      default: "DRAFT",
      required: true
    },
    processingProgress: { type: Number, default: 0 },
    processingError: { type: String }
  },
  {
    timestamps: true
  }
);

movieSchema.index({ slug: 1 });
movieSchema.index({ status: 1 });
movieSchema.index({ genres: 1 });
movieSchema.index({ releaseYear: 1 });
movieSchema.index({ title: "text", description: "text" });

export const Movie = model<IMovie>("Movie", movieSchema);
