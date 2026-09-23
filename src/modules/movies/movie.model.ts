import { Schema, model, Document, Types } from "mongoose";

export type MovieStatus = "DRAFT" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
export type MovieType = "MOVIE" | "SERIES";

export interface IEpisode {
  _id: Types.ObjectId;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  stillPath?: string;
  duration?: number; // in seconds
  airDate?: string;
  rating?: number;
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
  rating?: number;
  director?: string;
  cast?: Array<{ name: string; character?: string; image?: string }>;
  trailerUrl?: string;
  tmdbId?: number;
  totalSeasons?: number;
  episodes: IEpisode[];
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

const episodeSchema = new Schema<IEpisode>(
  {
    seasonNumber: { type: Number, required: true, default: 1 },
    episodeNumber: { type: Number, required: true, default: 1 },
    title: { type: String, required: true, trim: true },
    overview: { type: String, trim: true },
    stillPath: { type: String, trim: true },
    duration: { type: Number },
    airDate: { type: String },
    rating: { type: Number },
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
    rating: { type: Number },
    director: { type: String, trim: true },
    cast: [
      {
        name: { type: String, trim: true },
        character: { type: String, trim: true },
        image: { type: String, trim: true }
      }
    ],
    trailerUrl: { type: String, trim: true },
    tmdbId: { type: Number },
    totalSeasons: { type: Number, default: 1 },
    episodes: [episodeSchema],
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
movieSchema.index({ "episodes.seasonNumber": 1, "episodes.episodeNumber": 1 });

export const Movie = model<IMovie>("Movie", movieSchema);

