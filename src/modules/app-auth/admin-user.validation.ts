import { z } from "zod";

export const queryAdminUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
    status: z.enum(["ALL", "ACTIVE", "BLOCKED"]).default("ALL"),
    type: z.enum(["ALL", "REGISTERED", "GUEST"]).default("ALL"),
    sortBy: z.enum(["createdAt", "lastLoginAt", "displayName", "email"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc")
  })
});

export const updateUserStatusSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "BLOCKED"], {
      required_error: "Status must be either ACTIVE or BLOCKED"
    }),
    reason: z.string().trim().optional()
  })
});

export const blockUserSchema = z.object({
  body: z.object({
    reason: z.string().trim().optional()
  }).optional()
});

export type QueryAdminUsersInput = z.infer<typeof queryAdminUsersSchema>["query"];
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>["body"];
export type BlockUserInput = z.infer<typeof blockUserSchema>["body"];
