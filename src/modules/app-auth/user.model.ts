import { Schema, model, Document, Types } from "mongoose";
import bcrypt from "bcryptjs";

export type UserStatus = "ACTIVE" | "BLOCKED";

export interface IUser extends Document {
  _id: Types.ObjectId;
  displayName: string;
  email?: string;
  passwordHash?: string;
  avatarUrl?: string;
  isGuest: boolean;
  status: UserStatus;
  blockReason?: string;
  blockedAt?: Date;
  deviceId?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    displayName: { type: String, required: true, trim: true, default: "Cinephile" },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: undefined
    },
    passwordHash: { type: String },
    avatarUrl: { type: String, default: "" },
    isGuest: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ["ACTIVE", "BLOCKED"],
      default: "ACTIVE",
      index: true
    },
    blockReason: { type: String, trim: true },
    blockedAt: { type: Date },
    deviceId: { type: String, trim: true, index: true },
    lastLoginAt: { type: Date }
  },
  {
    timestamps: true
  }
);

// Unique index ONLY for users where email is a non-null string
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: "string" } }
  }
);

userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ displayName: "text", email: "text" });

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export const User = model<IUser>("User", userSchema);
