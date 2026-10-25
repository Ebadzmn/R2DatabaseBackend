import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters").trim(),
    email: z.string().email("Valid email address is required").toLowerCase().trim(),
    password: z.string().min(6, "Password must be at least 6 characters")
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email address is required").toLowerCase().trim(),
    password: z.string().min(1, "Password is required")
  })
});

export const guestLoginSchema = z.object({
  body: z
    .object({
      deviceId: z.string().optional(),
      displayName: z.string().optional()
    })
    .optional()
});

export const upgradeGuestSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters").trim(),
    email: z.string().email("Valid email address is required").toLowerCase().trim(),
    password: z.string().min(6, "Password must be at least 6 characters")
  })
});

export const updateProfileSchema = z.object({
  body: z.object({
    displayName: z.string().min(2).optional(),
    avatarUrl: z.string().url().or(z.literal("")).optional()
  })
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
export type GuestLoginInput = z.infer<typeof guestLoginSchema>["body"];
export type UpgradeGuestInput = z.infer<typeof upgradeGuestSchema>["body"];
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>["body"];
