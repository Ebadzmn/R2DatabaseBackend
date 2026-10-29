import { Schema, model, Document, Types } from "mongoose";

export interface IWatchlist extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  movieId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const watchlistSchema = new Schema<IWatchlist>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true, index: true }
  },
  {
    timestamps: true
  }
);

// Compound index to guarantee uniqueness: one entry per movie per user
watchlistSchema.index({ userId: 1, movieId: 1 }, { unique: true });
watchlistSchema.index({ userId: 1, createdAt: -1 });

export const Watchlist = model<IWatchlist>("Watchlist", watchlistSchema);
