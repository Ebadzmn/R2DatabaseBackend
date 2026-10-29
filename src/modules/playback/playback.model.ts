import { Schema, model, Document, Types } from "mongoose";

export type PlaybackStatus = "NOT_COMPLETED" | "IN_PROGRESS" | "COMPLETED";
export type PlaybackAction = "START" | "PAUSE" | "HEARTBEAT" | "EXIT" | "COMPLETED";

export interface IWatchHistory extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  movieId: Types.ObjectId;
  movieType: "MOVIE" | "SERIES";
  seasonNumber?: number;
  episodeNumber?: number;
  episodeId?: Types.ObjectId;
  episodeTitle?: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercentage: number;
  status: PlaybackStatus;
  lastAction: PlaybackAction;
  lastWatchedAt: Date;
  title: string;
  poster?: string;
  backdrop?: string;
  genres?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const watchHistorySchema = new Schema<IWatchHistory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true, index: true },
    movieType: { type: String, enum: ["MOVIE", "SERIES"], default: "MOVIE", required: true },
    seasonNumber: { type: Number, default: null },
    episodeNumber: { type: Number, default: null },
    episodeId: { type: Schema.Types.ObjectId, default: null },
    episodeTitle: { type: String, trim: true },
    positionSeconds: { type: Number, default: 0, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    progressPercentage: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["NOT_COMPLETED", "IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS",
      index: true
    },
    lastAction: {
      type: String,
      enum: ["START", "PAUSE", "HEARTBEAT", "EXIT", "COMPLETED"],
      default: "HEARTBEAT"
    },
    lastWatchedAt: { type: Date, default: Date.now, index: true },
    title: { type: String, required: true, trim: true },
    poster: { type: String, trim: true },
    backdrop: { type: String, trim: true },
    genres: [{ type: String, trim: true }]
  },
  {
    timestamps: true
  }
);

// Compound Unique Index: Prevents duplicate records for the same user, movie, and episode
watchHistorySchema.index(
  { userId: 1, movieId: 1, seasonNumber: 1, episodeNumber: 1 },
  { unique: true }
);

// High performance index for fast retrieval of user watch history
watchHistorySchema.index({ userId: 1, lastWatchedAt: -1 });

// Index for filtering continue watching items
watchHistorySchema.index({ userId: 1, status: 1, lastWatchedAt: -1 });

export const WatchHistory = model<IWatchHistory>("WatchHistory", watchHistorySchema);
