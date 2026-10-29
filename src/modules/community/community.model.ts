import { Schema, model, Document, Types } from "mongoose";

export type PostStatus = "ACTIVE" | "HIDDEN" | "REMOVED";
export type CommentStatus = "ACTIVE" | "REMOVED";
export type ReportContentType = "POST" | "COMMENT";
export type ReportStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "ACTION_TAKEN"
  | "REJECTED"
  | "RESOLVED"
  | "DISMISSED";
export type ReportReason =
  | "SPAM"
  | "INAPPROPRIATE"
  | "COPYRIGHT"
  | "HARASSMENT"
  | "MISLEADING"
  | "OTHER";

// ==========================================
// 1. Post Model
// ==========================================
export interface ICommunityPost extends Document {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  caption: string;
  images: string[];
  movieId?: Types.ObjectId;
  likesCount: number;
  commentsCount: number;
  reportsCount: number;
  status: PostStatus;
  moderationReason?: string;
  moderatedBy?: Types.ObjectId;
  moderatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const communityPostSchema = new Schema<ICommunityPost>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    caption: { type: String, required: true, trim: true, maxlength: 3000 },
    images: { type: [String], default: [] },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie", index: true },
    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    reportsCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["ACTIVE", "HIDDEN", "REMOVED"],
      default: "ACTIVE",
      index: true
    },
    moderationReason: { type: String, trim: true },
    moderatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    moderatedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

communityPostSchema.index({ status: 1, createdAt: -1 });
communityPostSchema.index({ authorId: 1, createdAt: -1 });

export const CommunityPost = model<ICommunityPost>("CommunityPost", communityPostSchema);

// ==========================================
// 2. Post Like Model
// ==========================================
export interface IPostLike extends Document {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt: Date;
}

const postLikeSchema = new Schema<IPostLike>(
  {
    postId: { type: Schema.Types.ObjectId, ref: "CommunityPost", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export const PostLike = model<IPostLike>("PostLike", postLikeSchema);

// ==========================================
// 3. Post Comment Model
// ==========================================
export interface IPostComment extends Document {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  status: CommentStatus;
  moderationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const postCommentSchema = new Schema<IPostComment>(
  {
    postId: { type: Schema.Types.ObjectId, ref: "CommunityPost", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["ACTIVE", "REMOVED"],
      default: "ACTIVE",
      index: true
    },
    moderationReason: { type: String, trim: true }
  },
  {
    timestamps: true
  }
);

postCommentSchema.index({ postId: 1, status: 1, createdAt: 1 });

export const PostComment = model<IPostComment>("PostComment", postCommentSchema);

// ==========================================
// 4. Content Report Model
// ==========================================
export interface IPostReport extends Document {
  _id: Types.ObjectId;
  reportedContentType: ReportContentType;
  contentId: Types.ObjectId;
  postId: Types.ObjectId;
  reporterId: Types.ObjectId;
  contentOwnerId?: Types.ObjectId;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  actionTaken?: string; // e.g. "CONTENT_REMOVED", "NO_ACTION", "NONE"
  userNotification?: string; // Public status message visible to reporting user
  adminNotes?: string; // Private internal notes for moderators only
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const postReportSchema = new Schema<IPostReport>(
  {
    reportedContentType: {
      type: String,
      enum: ["POST", "COMMENT"],
      required: true,
      index: true
    },
    contentId: { type: Schema.Types.ObjectId, required: true, index: true },
    postId: { type: Schema.Types.ObjectId, ref: "CommunityPost", required: true, index: true },
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    contentOwnerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    reason: {
      type: String,
      enum: ["SPAM", "INAPPROPRIATE", "COPYRIGHT", "HARASSMENT", "MISLEADING", "OTHER"],
      required: true
    },
    details: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["PENDING", "UNDER_REVIEW", "ACTION_TAKEN", "REJECTED", "RESOLVED", "DISMISSED"],
      default: "PENDING",
      index: true
    },
    actionTaken: { type: String, default: "NONE" },
    userNotification: { type: String, trim: true },
    adminNotes: { type: String, trim: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    reviewedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

postReportSchema.index({ status: 1, createdAt: -1 });
postReportSchema.index({ reporterId: 1, createdAt: -1 });
postReportSchema.index({ contentId: 1, reporterId: 1, status: 1 });
postReportSchema.index({ postId: 1, status: 1 });

export const PostReport = model<IPostReport>("PostReport", postReportSchema);

// ==========================================
// 5. Moderation Audit History Model
// ==========================================
export interface IModerationAudit extends Document {
  _id: Types.ObjectId;
  targetType: "POST" | "COMMENT";
  targetId: Types.ObjectId;
  authorId: Types.ObjectId;
  captionPreview?: string;
  images?: string[];
  movieId?: Types.ObjectId;
  action: "REMOVE" | "RESTORE" | "HIDE" | "ACTION_TAKEN" | "REJECT" | "RESOLVE";
  reason: string;
  adminId?: Types.ObjectId;
  reportIds?: Types.ObjectId[];
  reporters?: Types.ObjectId[];
  metadata?: Record<string, any>;
  createdAt: Date;
}

const moderationAuditSchema = new Schema<IModerationAudit>(
  {
    targetType: { type: String, enum: ["POST", "COMMENT"], required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    captionPreview: { type: String, trim: true },
    images: { type: [String], default: [] },
    movieId: { type: Schema.Types.ObjectId, ref: "Movie" },
    action: {
      type: String,
      enum: ["REMOVE", "RESTORE", "HIDE", "ACTION_TAKEN", "REJECT", "RESOLVE"],
      required: true,
      index: true
    },
    reason: { type: String, required: true, trim: true },
    adminId: { type: Schema.Types.ObjectId, ref: "AdminUser", index: true },
    reportIds: [{ type: Schema.Types.ObjectId, ref: "PostReport" }],
    reporters: [{ type: Schema.Types.ObjectId, ref: "User" }],
    metadata: { type: Schema.Types.Mixed }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

moderationAuditSchema.index({ createdAt: -1 });
moderationAuditSchema.index({ targetId: 1, createdAt: -1 });

export const ModerationAudit = model<IModerationAudit>("ModerationAudit", moderationAuditSchema);
