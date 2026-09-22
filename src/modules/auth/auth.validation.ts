import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email is required"),
    password: z.string().min(6, "Password must be at least 6 characters")
  })
});

export type LoginInput = z.infer<typeof loginSchema>["body"];
