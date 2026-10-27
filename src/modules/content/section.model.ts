import { Schema, model, Document, Types } from "mongoose";

export type SectionType = "TOP_10" | "MOVIE_ROW" | "SERIES_ROW" | "GRID" | "BANNER";
export type SectionContentType = "MOVIE" | "SERIES" | "MIXED";

export interface ISectionItem {
  movieId: Types.ObjectId;
  order: number;
  customTag?: string;
  addedAt?: Date;
}

export interface IHomeSection extends Document {
  _id: Types.ObjectId;
  key: string;
  title: string;
  subtitle?: string;
  sectionType: SectionType;
  contentType: SectionContentType;
  items: ISectionItem[];
  maxItems?: number;
  order: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SectionItemSchema = new Schema<ISectionItem>(
  {
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", required: true },
    order: { type: Number, default: 0 },
    customTag: { type: String, trim: true },
    addedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const HomeSectionSchema = new Schema<IHomeSection>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    sectionType: {
      type: String,
      enum: ["TOP_10", "MOVIE_ROW", "SERIES_ROW", "GRID", "BANNER"],
      default: "MOVIE_ROW"
    },
    contentType: {
      type: String,
      enum: ["MOVIE", "SERIES", "MIXED"],
      default: "MOVIE"
    },
    items: { type: [SectionItemSchema], default: [] },
    maxItems: { type: Number, default: 10 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    isSystem: { type: Boolean, default: false }
  },
  { timestamps: true }
);

HomeSectionSchema.index({ order: 1, isActive: 1 });

export const HomeSection = model<IHomeSection>("HomeSection", HomeSectionSchema);
