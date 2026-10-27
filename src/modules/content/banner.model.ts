import { Schema, model, Document, Types } from "mongoose";

export type BannerMediaType = "MOVIE" | "SERIES" | "CUSTOM";
export type BannerCtaAction = "PLAY" | "DETAILS" | "LINK";

export interface IHeroBanner extends Document {
  _id: Types.ObjectId;
  title: string;
  subtitle?: string;
  description?: string;
  mediaType: BannerMediaType;
  movieId?: Types.ObjectId;
  customImageUrl?: string;
  badge?: string;
  ctaText?: string;
  ctaAction?: BannerCtaAction;
  targetUrl?: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HeroBannerSchema = new Schema<IHeroBanner>(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    description: { type: String, trim: true },
    mediaType: {
      type: String,
      enum: ["MOVIE", "SERIES", "CUSTOM"],
      default: "MOVIE"
    },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie" },
    customImageUrl: { type: String, trim: true },
    badge: { type: String, trim: true },
    ctaText: { type: String, trim: true, default: "WATCH NOW" },
    ctaAction: {
      type: String,
      enum: ["PLAY", "DETAILS", "LINK"],
      default: "PLAY"
    },
    targetUrl: { type: String, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

HeroBannerSchema.index({ order: 1, isActive: 1 });

export const HeroBanner = model<IHeroBanner>("HeroBanner", HeroBannerSchema);
