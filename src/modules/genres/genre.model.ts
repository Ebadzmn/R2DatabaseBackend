import { Schema, model, Document, Types } from "mongoose";

export interface IGenre extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  icon: string;
  gradientStart?: string;
  gradientEnd?: string;
  description?: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const genreSchema = new Schema<IGenre>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true, lowercase: true },
    icon: { type: String, default: "film", trim: true },
    gradientStart: { type: String, default: "#F59E0B", trim: true },
    gradientEnd: { type: String, default: "#D97706", trim: true },
    description: { type: String, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: true
  }
);

genreSchema.index({ slug: 1 });
genreSchema.index({ order: 1 });
genreSchema.index({ isActive: 1 });

export const Genre = model<IGenre>("Genre", genreSchema);
