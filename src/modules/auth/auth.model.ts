import { Schema, model, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IAdminUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: "ADMIN";
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ["ADMIN"], default: "ADMIN" },
    lastLoginAt: { type: Date }
  },
  {
    timestamps: true
  }
);

adminUserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export const AdminUser = model<IAdminUser>("AdminUser", adminUserSchema);
