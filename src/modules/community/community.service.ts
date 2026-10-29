import { Types } from "mongoose";
import fs from "fs";
import path from "path";
import {
  CommunityPost,
  PostLike,
  PostComment,
  PostReport,
  ModerationAudit,
  ICommunityPost,
  IPostComment,
  IPostReport,
  IModerationAudit,
  PostStatus,
  ReportStatus,
  ReportReason,
  ReportContentType
} from "./community.model";
import { User } from "../app-auth/user.model";
import { Movie } from "../movies/movie.model";
import { StorageManagerService } from "../../services/storage-manager.service";
import { R2Service } from "../storage/r2.service";
import { BadRequestError, NotFoundError, ForbiddenError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export interface CreatePostDto {
  caption: string;
  images?: string[];
  movieId?: string;
}

export interface UpdatePostDto {
  caption?: string;
  images?: string[];
  movieId?: string;
}

export interface ReportContentDto {
  reportedContentType: ReportContentType;
  contentId: string;
  reason: ReportReason;
  details?: string;
}

export interface ImageUploadInput {
  data: string; // Base64 string or data URL
  mimeType?: string;
  fileName?: string;
}

export class CommunityService {
  /**
   * Uploads base64 encoded images to Cloudflare R2 (or fallback local static storage)
   */
  public static async uploadImages(
    files: ImageUploadInput[]
  ): Promise<string[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let base64Data = file.data;
      let mimeType = file.mimeType || "image/jpeg";

      // If data URL format like "data:image/png;base64,..."
      if (base64Data.startsWith("data:")) {
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          mimeType = matches[1];
          base64Data = matches[2];
        }
      }

      const buffer = Buffer.from(base64Data, "base64");
      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
        ? "webp"
        : "jpg";
      const key = `community/posts/${Date.now()}-${new Types.ObjectId().toString()}.${ext}`;

      try {
        // Attempt R2 storage upload
        const storageAccount = await StorageManagerService.selectStorage(buffer.length);
        await R2Service.putObject(storageAccount, key, buffer, mimeType);

        const baseUrl =
          storageAccount.publicUrl ||
          process.env.STREAMING_BASE_URL ||
          "";

        const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
        uploadedUrls.push(`${cleanBaseUrl}/${key}`);
      } catch (r2Err: any) {
        logger.warn(
          { err: r2Err?.message },
          "R2 upload unavailable, falling back to local static storage for community image"
        );

        // Fallback: local public/uploads directory
        const uploadDir = path.join(process.cwd(), "public", "uploads", "community");
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${new Types.ObjectId().toString()}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, buffer);

        uploadedUrls.push(`/uploads/community/${fileName}`);
      }
    }

    return uploadedUrls;
  }

  /**
   * Retrieves public feed with pagination, author details, linked movie, and current user's like state
   */
  public static async getFeed(params: {
    currentUserId?: string;
    page?: number;
    limit?: number;
    movieId?: string;
    authorId?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 15));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { status: "ACTIVE" };

    if (params.movieId && Types.ObjectId.isValid(params.movieId)) {
      filter.movieId = new Types.ObjectId(params.movieId);
    }
    if (params.authorId && Types.ObjectId.isValid(params.authorId)) {
      filter.authorId = new Types.ObjectId(params.authorId);
    }

    const [posts, total] = await Promise.all([
      CommunityPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "displayName avatarUrl isGuest createdAt")
        .populate("movieId", "title poster type releaseYear genres duration")
        .lean(),
      CommunityPost.countDocuments(filter)
    ]);

    // Check likes for current user
    let likedPostIds = new Set<string>();
    if (params.currentUserId && Types.ObjectId.isValid(params.currentUserId)) {
      const postIds = posts.map((p) => p._id);
      const userLikes = await PostLike.find({
        userId: new Types.ObjectId(params.currentUserId),
        postId: { $in: postIds }
      }).select("postId");

      likedPostIds = new Set(userLikes.map((l) => l.postId.toString()));
    }

    const formattedPosts = posts.map((p) => ({
      ...p,
      isLikedByMe: likedPostIds.has(p._id.toString()),
      isOwner: params.currentUserId ? p.authorId?._id?.toString() === params.currentUserId : false
    }));

    return {
      posts: formattedPosts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + posts.length < total
      }
    };
  }

  /**
   * Retrieves single post by ID
   */
  public static async getPostById(postId: string, currentUserId?: string) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const post = await CommunityPost.findById(postId)
      .populate("authorId", "displayName avatarUrl isGuest createdAt")
      .populate("movieId", "title poster type releaseYear genres duration")
      .lean();

    if (!post || post.status === "REMOVED") {
      throw new NotFoundError("Post not found or has been removed");
    }

    let isLikedByMe = false;
    if (currentUserId && Types.ObjectId.isValid(currentUserId)) {
      const like = await PostLike.findOne({
        postId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(currentUserId)
      });
      isLikedByMe = !!like;
    }

    return {
      ...post,
      isLikedByMe,
      isOwner: currentUserId ? post.authorId?._id?.toString() === currentUserId : false
    };
  }

  /**
   * Creates a new community post
   */
  public static async createPost(
    authorId: string,
    dto: CreatePostDto
  ): Promise<ICommunityPost> {
    if (!dto.caption || !dto.caption.trim()) {
      throw new BadRequestError("Caption text is required");
    }

    const user = await User.findById(authorId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    if (user.status === "BLOCKED") {
      throw new ForbiddenError("Your account is blocked from creating posts");
    }

    let movieObjectId: Types.ObjectId | undefined = undefined;
    if (dto.movieId) {
      if (!Types.ObjectId.isValid(dto.movieId)) {
        throw new BadRequestError("Invalid movie ID format");
      }
      const movie = await Movie.findById(dto.movieId).select("_id title");
      if (!movie) {
        throw new NotFoundError("Associated movie not found");
      }
      movieObjectId = movie._id;
    }

    const post = await CommunityPost.create({
      authorId: user._id,
      caption: dto.caption.trim(),
      images: Array.isArray(dto.images) ? dto.images : [],
      movieId: movieObjectId,
      status: "ACTIVE"
    });

    const populated = await CommunityPost.findById(post._id)
      .populate("authorId", "displayName avatarUrl isGuest createdAt")
      .populate("movieId", "title poster type releaseYear genres duration");

    return populated!;
  }

  /**
   * Updates an existing post (only by author)
   */
  public static async updatePost(
    authorId: string,
    postId: string,
    dto: UpdatePostDto
  ): Promise<ICommunityPost> {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const post = await CommunityPost.findById(postId);
    if (!post || post.status === "REMOVED") {
      throw new NotFoundError("Post not found");
    }

    if (post.authorId.toString() !== authorId) {
      throw new ForbiddenError("You can only edit your own posts");
    }

    if (dto.caption !== undefined) {
      if (!dto.caption.trim()) {
        throw new BadRequestError("Caption cannot be empty");
      }
      post.caption = dto.caption.trim();
    }

    if (dto.images !== undefined) {
      post.images = dto.images;
    }

    if (dto.movieId !== undefined) {
      if (dto.movieId && Types.ObjectId.isValid(dto.movieId)) {
        const movie = await Movie.findById(dto.movieId);
        if (movie) post.movieId = movie._id;
      } else {
        post.movieId = undefined;
      }
    }

    await post.save();

    const populated = await CommunityPost.findById(post._id)
      .populate("authorId", "displayName avatarUrl isGuest createdAt")
      .populate("movieId", "title poster type releaseYear genres duration");

    return populated!;
  }

  /**
   * Deletes a post (by author or admin)
   */
  public static async deletePost(
    userId: string,
    postId: string,
    isAdmin = false,
    adminReason?: string
  ): Promise<void> {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const post = await CommunityPost.findById(postId);
    if (!post) {
      throw new NotFoundError("Post not found");
    }

    if (!isAdmin && post.authorId.toString() !== userId) {
      throw new ForbiddenError("You can only delete your own posts");
    }

    // Soft delete
    post.status = "REMOVED";
    post.moderationReason = isAdmin ? (adminReason || "Deleted by Administrator") : "Deleted by user";
    if (isAdmin) {
      post.moderatedBy = new Types.ObjectId(userId);
      post.moderatedAt = new Date();
    }
    await post.save();

    // If deleted by admin, record audit log
    if (isAdmin) {
      const reports = await PostReport.find({ contentId: post._id });
      await ModerationAudit.create({
        targetType: "POST",
        targetId: post._id,
        authorId: post.authorId,
        captionPreview: post.caption,
        images: post.images,
        movieId: post.movieId,
        action: "REMOVE",
        reason: adminReason || "Post removed by administrator",
        adminId: new Types.ObjectId(userId),
        reportIds: reports.map((r) => r._id),
        reporters: reports.map((r) => r.reporterId)
      });
    }
  }

  /**
   * Toggles Like/Unlike on a post atomically
   */
  public static async toggleLike(
    userId: string,
    postId: string
  ): Promise<{ isLiked: boolean; likesCount: number }> {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const post = await CommunityPost.findById(postId);
    if (!post || post.status === "REMOVED") {
      throw new NotFoundError("Post not found");
    }

    const userObjId = new Types.ObjectId(userId);
    const postObjId = new Types.ObjectId(postId);

    const existingLike = await PostLike.findOneAndDelete({
      postId: postObjId,
      userId: userObjId
    });

    if (existingLike) {
      const updatedPost = await CommunityPost.findByIdAndUpdate(
        postObjId,
        { $inc: { likesCount: -1 } },
        { new: true }
      );
      const likesCount = Math.max(0, updatedPost?.likesCount ?? 0);
      return { isLiked: false, likesCount };
    } else {
      try {
        await PostLike.create({
          postId: postObjId,
          userId: userObjId
        });
      } catch (duplicateErr) {
        // Ignored
      }

      const updatedPost = await CommunityPost.findByIdAndUpdate(
        postObjId,
        { $inc: { likesCount: 1 } },
        { new: true }
      );

      return { isLiked: true, likesCount: updatedPost?.likesCount ?? 1 };
    }
  }

  /**
   * Retrieves comments for a post
   */
  public static async getComments(
    postId: string,
    page = 1,
    limit = 50
  ) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const filter = {
      postId: new Types.ObjectId(postId),
      status: "ACTIVE"
    };

    const [comments, total] = await Promise.all([
      PostComment.find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(safeLimit)
        .populate("authorId", "displayName avatarUrl isGuest")
        .lean(),
      PostComment.countDocuments(filter)
    ]);

    return {
      comments,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        hasMore: skip + comments.length < total
      }
    };
  }

  /**
   * Adds a comment to a post
   */
  public static async addComment(
    authorId: string,
    postId: string,
    content: string
  ): Promise<IPostComment> {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }
    if (!content || !content.trim()) {
      throw new BadRequestError("Comment text cannot be empty");
    }

    const post = await CommunityPost.findById(postId);
    if (!post || post.status === "REMOVED") {
      throw new NotFoundError("Post not found");
    }

    const user = await User.findById(authorId);
    if (!user || user.status === "BLOCKED") {
      throw new ForbiddenError("You cannot post comments");
    }

    const comment = await PostComment.create({
      postId: post._id,
      authorId: user._id,
      content: content.trim(),
      status: "ACTIVE"
    });

    await CommunityPost.findByIdAndUpdate(post._id, { $inc: { commentsCount: 1 } });

    const populated = await PostComment.findById(comment._id).populate(
      "authorId",
      "displayName avatarUrl isGuest"
    );

    return populated!;
  }

  /**
   * Deletes a comment
   */
  public static async deleteComment(
    userId: string,
    commentId: string,
    isAdmin = false
  ): Promise<void> {
    if (!Types.ObjectId.isValid(commentId)) {
      throw new BadRequestError("Invalid comment ID");
    }

    const comment = await PostComment.findById(commentId);
    if (!comment || comment.status === "REMOVED") {
      throw new NotFoundError("Comment not found");
    }

    if (!isAdmin && comment.authorId.toString() !== userId) {
      throw new ForbiddenError("You can only delete your own comments");
    }

    comment.status = "REMOVED";
    comment.moderationReason = isAdmin ? "Removed by Administrator" : "Deleted by user";
    await comment.save();

    await CommunityPost.findByIdAndUpdate(comment.postId, {
      $inc: { commentsCount: -1 }
    });
  }

  /**
   * Submits a report for a post or comment
   */
  public static async reportContent(
    reporterId: string,
    dto: ReportContentDto
  ): Promise<IPostReport> {
    if (!Types.ObjectId.isValid(dto.contentId)) {
      throw new BadRequestError("Invalid content ID");
    }

    const contentObjId = new Types.ObjectId(dto.contentId);
    const reporterObjId = new Types.ObjectId(reporterId);

    // Prevent duplicate active reports by same reporter
    const existingReport = await PostReport.findOne({
      contentId: contentObjId,
      reporterId: reporterObjId,
      status: { $in: ["PENDING", "UNDER_REVIEW"] }
    });

    if (existingReport) {
      throw new BadRequestError(
        "You have already submitted a pending report for this item. Our moderation team is reviewing it."
      );
    }

    let postObjId: Types.ObjectId;
    let contentOwnerId: Types.ObjectId | undefined;

    if (dto.reportedContentType === "POST") {
      const post = await CommunityPost.findById(contentObjId);
      if (!post) throw new NotFoundError("Reported post does not exist");
      postObjId = post._id;
      contentOwnerId = post.authorId;
    } else {
      const comment = await PostComment.findById(contentObjId);
      if (!comment) throw new NotFoundError("Reported comment does not exist");
      postObjId = comment.postId;
      contentOwnerId = comment.authorId;
    }

    const report = await PostReport.create({
      reportedContentType: dto.reportedContentType,
      contentId: contentObjId,
      postId: postObjId,
      reporterId: reporterObjId,
      contentOwnerId,
      reason: dto.reason,
      details: dto.details?.trim(),
      status: "PENDING",
      actionTaken: "NONE",
      userNotification: "Report submitted. Under queue for moderation review."
    });

    await CommunityPost.findByIdAndUpdate(postObjId, { $inc: { reportsCount: 1 } });

    return report;
  }

  /**
   * Retrieves reports submitted by the logged-in user ("My Reports")
   */
  public static async getMyReports(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID");
    }

    const reports = await PostReport.find({
      reporterId: new Types.ObjectId(userId)
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "postId",
        select: "caption images status createdAt authorId movieId",
        populate: [
          { path: "authorId", select: "displayName avatarUrl" },
          { path: "movieId", select: "title poster type" }
        ]
      })
      .lean();

    return reports.map((r: any) => ({
      _id: r._id,
      reportedContentType: r.reportedContentType,
      contentId: r.contentId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      actionTaken: r.actionTaken || "NONE",
      userNotification: r.userNotification || (
        r.status === "ACTION_TAKEN"
          ? "Action taken: The reported content was removed for violating community guidelines."
          : r.status === "REJECTED" || r.status === "DISMISSED"
          ? "Report reviewed: No violation was found."
          : r.status === "UNDER_REVIEW"
          ? "A moderator is currently reviewing this content."
          : "Report received and queued for review."
      ),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      post: r.postId
        ? {
            id: r.postId._id,
            caption: r.postId.caption,
            images: r.postId.images || [],
            status: r.postId.status,
            authorName: r.postId.authorId?.displayName || "User",
            movieTitle: r.postId.movieId?.title
          }
        : null
    }));
  }

  /**
   * Retrieves public user profile and their active community posts
   */
  public static async getUserProfile(targetUserId: string, currentUserId?: string) {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError("Invalid user ID format");
    }

    const user = await User.findById(targetUserId).select(
      "_id displayName avatarUrl isGuest status createdAt email"
    ).lean();

    if (!user) {
      throw new NotFoundError("User account not found");
    }

    const [posts, totalPosts] = await Promise.all([
      CommunityPost.find({
        authorId: user._id,
        status: "ACTIVE"
      })
        .sort({ createdAt: -1 })
        .populate("movieId", "title poster type releaseYear")
        .lean(),
      CommunityPost.countDocuments({
        authorId: user._id,
        status: "ACTIVE"
      })
    ]);

    // Check likes for current user
    let likedPostIds = new Set<string>();
    if (currentUserId && Types.ObjectId.isValid(currentUserId)) {
      const postIds = posts.map((p) => p._id);
      const userLikes = await PostLike.find({
        userId: new Types.ObjectId(currentUserId),
        postId: { $in: postIds }
      }).select("postId");

      likedPostIds = new Set(userLikes.map((l) => l.postId.toString()));
    }

    const formattedPosts = posts.map((p) => ({
      ...p,
      authorId: {
        _id: user._id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isGuest: user.isGuest
      },
      isLikedByMe: likedPostIds.has(p._id.toString()),
      isOwner: currentUserId ? user._id.toString() === currentUserId : false
    }));

    return {
      user: {
        _id: user._id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isGuest: user.isGuest,
        status: user.status,
        createdAt: user.createdAt,
        email: currentUserId === user._id.toString() ? user.email : undefined
      },
      totalPosts,
      posts: formattedPosts
    };
  }

  // ==========================================
  // Admin Moderation Methods
  // ==========================================

  public static async getFeedStats() {
    const [
      totalPosts,
      totalComments,
      totalLikes,
      totalReports,
      pendingReports,
      resolvedReports,
      removedPosts
    ] = await Promise.all([
      CommunityPost.countDocuments(),
      PostComment.countDocuments(),
      PostLike.countDocuments(),
      PostReport.countDocuments(),
      PostReport.countDocuments({ status: { $in: ["PENDING", "UNDER_REVIEW"] } }),
      PostReport.countDocuments({ status: { $in: ["RESOLVED", "ACTION_TAKEN"] } }),
      CommunityPost.countDocuments({ status: "REMOVED" })
    ]);

    return {
      totalPosts,
      totalComments,
      totalLikes,
      totalReports,
      pendingReports,
      resolvedReports,
      removedPosts
    };
  }

  public static async getAdminPosts(params: {
    page?: number;
    limit?: number;
    status?: PostStatus;
    search?: string;
    minReports?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (params.status) {
      filter.status = params.status;
    }

    if (params.minReports && Number(params.minReports) > 0) {
      filter.reportsCount = { $gte: Number(params.minReports) };
    }

    if (params.search && params.search.trim()) {
      filter.caption = { $regex: params.search.trim(), $options: "i" };
    }

    const [posts, total] = await Promise.all([
      CommunityPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "displayName email avatarUrl status isGuest")
        .populate("movieId", "title poster type releaseYear")
        .lean(),
      CommunityPost.countDocuments(filter)
    ]);

    return {
      posts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  public static async moderatePost(
    adminId: string,
    postId: string,
    action: "REMOVE" | "RESTORE" | "HIDE",
    reason?: string
  ) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID");
    }

    const post = await CommunityPost.findById(postId);
    if (!post) throw new NotFoundError("Post not found");

    if (action === "REMOVE") {
      post.status = "REMOVED";
    } else if (action === "HIDE") {
      post.status = "HIDDEN";
    } else if (action === "RESTORE") {
      post.status = "ACTIVE";
    }

    post.moderationReason = reason?.trim() || `Moderated to ${action}`;
    post.moderatedBy = new Types.ObjectId(adminId);
    post.moderatedAt = new Date();
    await post.save();

    // Log to audit history
    const reports = await PostReport.find({ contentId: post._id });
    await ModerationAudit.create({
      targetType: "POST",
      targetId: post._id,
      authorId: post.authorId,
      captionPreview: post.caption,
      images: post.images,
      movieId: post.movieId,
      action,
      reason: reason || `Post status updated to ${action}`,
      adminId: new Types.ObjectId(adminId),
      reportIds: reports.map((r) => r._id),
      reporters: reports.map((r) => r.reporterId)
    });

    return post;
  }

  /**
   * Retrieves reports for Admin Management with full reporters and author data
   */
  public static async getAdminReports(params: {
    page?: number;
    limit?: number;
    status?: string;
    reason?: string;
    contentType?: ReportContentType;
    postId?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (params.status && params.status !== "ALL") {
      filter.status = params.status;
    }
    if (params.reason && params.reason !== "ALL") {
      filter.reason = params.reason;
    }
    if (params.contentType) {
      filter.reportedContentType = params.contentType;
    }
    if (params.postId && Types.ObjectId.isValid(params.postId)) {
      filter.postId = new Types.ObjectId(params.postId);
    }

    const [reports, total] = await Promise.all([
      PostReport.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reporterId", "_id displayName email avatarUrl status isGuest")
        .populate("contentOwnerId", "_id displayName email avatarUrl status")
        .populate({
          path: "postId",
          select: "_id caption images status authorId",
          populate: { path: "authorId", select: "_id displayName email avatarUrl" }
        })
        .lean(),
      PostReport.countDocuments(filter)
    ]);

    // Enhance comment details if contentType is COMMENT
    const enhancedReports = await Promise.all(
      reports.map(async (r) => {
        if (r.reportedContentType === "COMMENT") {
          const comment = await PostComment.findById(r.contentId).lean();
          return { ...r, commentPreview: comment ? comment.content : "[Comment removed]" };
        }
        return r;
      })
    );

    return {
      reports: enhancedReports,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Resolves or rejects report, updates post/comment, updates all related reports, and records audit
   */
  public static async resolveReport(
    adminId: string,
    reportId: string,
    input: {
      status: ReportStatus;
      adminNotes?: string;
      userNotification?: string;
      actionOnContent?: "REMOVE" | "RESTORE" | "NONE";
      contentRemovalReason?: string;
    }
  ) {
    if (!Types.ObjectId.isValid(reportId)) {
      throw new BadRequestError("Invalid report ID");
    }

    const report = await PostReport.findById(reportId);
    if (!report) throw new NotFoundError("Report not found");

    report.status = input.status;
    report.adminNotes = input.adminNotes?.trim();
    if (input.userNotification) {
      report.userNotification = input.userNotification.trim();
    }
    report.reviewedBy = new Types.ObjectId(adminId);
    report.reviewedAt = new Date();

    const post = await CommunityPost.findById(report.postId);

    if (input.actionOnContent === "REMOVE") {
      const reason = input.contentRemovalReason || "Removed following user report";
      report.actionTaken = "CONTENT_REMOVED";
      report.userNotification =
        input.userNotification || "Action taken: The reported content was removed for violating community guidelines.";

      if (report.reportedContentType === "POST") {
        if (post) {
          post.status = "REMOVED";
          post.moderationReason = reason;
          post.moderatedBy = new Types.ObjectId(adminId);
          post.moderatedAt = new Date();
          await post.save();
        }
      } else {
        await PostComment.findByIdAndUpdate(report.contentId, {
          status: "REMOVED",
          moderationReason: reason
        });
      }

      // Update all other reports on the same content
      const allRelatedReports = await PostReport.find({ contentId: report.contentId });
      const reportIds = allRelatedReports.map((r) => r._id);
      const reporterIds = allRelatedReports.map((r) => r.reporterId);

      await PostReport.updateMany(
        { contentId: report.contentId },
        {
          status: "ACTION_TAKEN",
          actionTaken: "CONTENT_REMOVED",
          userNotification:
            input.userNotification || "Action taken: The reported content was removed for violating community guidelines.",
          reviewedBy: new Types.ObjectId(adminId),
          reviewedAt: new Date()
        }
      );

      // Record in ModerationAudit
      if (post) {
        await ModerationAudit.create({
          targetType: report.reportedContentType,
          targetId: report.contentId,
          authorId: post.authorId,
          captionPreview: post.caption,
          images: post.images,
          movieId: post.movieId,
          action: "REMOVE",
          reason,
          adminId: new Types.ObjectId(adminId),
          reportIds,
          reporters: reporterIds
        });
      }
    } else if (input.actionOnContent === "RESTORE") {
      report.actionTaken = "RESTORED";
      report.userNotification = input.userNotification || "Content reviewed and restored.";
      if (report.reportedContentType === "POST") {
        await CommunityPost.findByIdAndUpdate(report.contentId, {
          status: "ACTIVE",
          moderationReason: "Restored by administrator"
        });
      } else {
        await PostComment.findByIdAndUpdate(report.contentId, { status: "ACTIVE" });
      }
    } else {
      if (input.status === "REJECTED" || input.status === "DISMISSED") {
        report.actionTaken = "NO_ACTION";
        report.userNotification = input.userNotification || "Report reviewed: No guideline violation was found.";
      }
    }

    await report.save();
    return report;
  }

  /**
   * Retrieves Moderation Audit History / Deleted Posts for Admin
   */
  public static async getModerationHistory(params: {
    page?: number;
    limit?: number;
    search?: string;
    action?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (params.action && params.action !== "ALL") {
      filter.action = params.action;
    }

    if (params.search && params.search.trim()) {
      filter.$or = [
        { captionPreview: { $regex: params.search.trim(), $options: "i" } },
        { reason: { $regex: params.search.trim(), $options: "i" } }
      ];
    }

    const [logs, total] = await Promise.all([
      ModerationAudit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "_id displayName email avatarUrl status isGuest")
        .populate("reporters", "_id displayName email avatarUrl")
        .populate("adminId", "_id name email username")
        .populate("movieId", "title poster type releaseYear")
        .lean(),
      ModerationAudit.countDocuments(filter)
    ]);

    return {
      history: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  public static async getAdminComments(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (params.search && params.search.trim()) {
      filter.content = { $regex: params.search.trim(), $options: "i" };
    }

    const [comments, total] = await Promise.all([
      PostComment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "displayName email avatarUrl status")
        .populate("postId", "caption images status")
        .lean(),
      PostComment.countDocuments(filter)
    ]);

    return {
      comments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}
