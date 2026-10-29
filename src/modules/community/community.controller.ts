import { Request, Response, NextFunction } from "express";
import { CommunityService } from "./community.service";
import { sendSuccess } from "../../utils/response";
import { BadRequestError, UnauthorizedError } from "../../utils/errors";

export class CommunityController {
  // ==========================================
  // End-User Mobile Client Handlers
  // ==========================================

  public static async getFeed(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.user?.userId;
      const { page, limit, movieId, authorId } = req.query;

      const result = await CommunityService.getFeed({
        currentUserId,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        movieId: movieId as string,
        authorId: authorId as string
      });

      sendSuccess(res, result.posts, "Community feed retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async getPostById(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.user?.userId;
      const post = await CommunityService.getPostById(req.params.id, currentUserId);
      sendSuccess(res, post, "Post retrieved successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async createPost(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const post = await CommunityService.createPost(userId, req.body);
      sendSuccess(res, post, "Post published successfully", 201);
    } catch (err) {
      next(err);
    }
  }

  public static async updatePost(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const post = await CommunityService.updatePost(userId, req.params.id, req.body);
      sendSuccess(res, post, "Post updated successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async deletePost(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = Boolean((req as any).admin);
      const adminId = (req as any).admin?.adminId || (req as any).admin?.id;
      const userId = isAdmin ? adminId : req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }
      const adminReason = req.body?.reason || (isAdmin ? "Removed by administrator" : undefined);
      await CommunityService.deletePost(userId, req.params.id, isAdmin, adminReason);
      sendSuccess(res, null, "Post deleted successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async toggleLike(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const result = await CommunityService.toggleLike(userId, req.params.id);
      sendSuccess(res, result, result.isLiked ? "Post liked" : "Post unliked");
    } catch (err) {
      next(err);
    }
  }

  public static async getComments(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await CommunityService.getComments(
        req.params.id,
        page ? Number(page) : undefined,
        limit ? Number(limit) : undefined
      );
      sendSuccess(res, result.comments, "Comments retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { content } = req.body;
      const comment = await CommunityService.addComment(userId, req.params.id, content);
      sendSuccess(res, comment, "Comment added successfully", 201);
    } catch (err) {
      next(err);
    }
  }

  public static async deleteComment(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = Boolean((req as any).admin);
      const adminId = (req as any).admin?.adminId || (req as any).admin?.id;
      const userId = isAdmin ? adminId : req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required");
      }
      await CommunityService.deleteComment(userId, req.params.id, isAdmin);
      sendSuccess(res, null, "Comment deleted successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async reportContent(req: Request, res: Response, next: NextFunction) {
    try {
      const reporterId = req.user!.userId;
      const report = await CommunityService.reportContent(reporterId, req.body);
      sendSuccess(
        res,
        report,
        "Thank you. Your report has been submitted for moderation review.",
        201
      );
    } catch (err) {
      next(err);
    }
  }

  public static async getMyReports(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const reports = await CommunityService.getMyReports(userId);
      sendSuccess(res, reports, "My reports retrieved successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async getUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.user?.userId;
      const profile = await CommunityService.getUserProfile(req.params.id, currentUserId);
      sendSuccess(res, profile, "User profile retrieved successfully");
    } catch (err) {
      next(err);
    }
  }

  public static async uploadImages(req: Request, res: Response, next: NextFunction) {
    try {
      const rawFiles = req.body.images || req.body.files;
      if (!rawFiles || !Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw new BadRequestError("No images provided for upload");
      }

      const files = rawFiles.map((item: any) => {
        if (typeof item === "string") {
          return { data: item };
        }
        return item;
      });

      const urls = await CommunityService.uploadImages(files);
      sendSuccess(res, { urls }, "Images uploaded successfully", 201);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================
  // Admin Management Handlers
  // ==========================================

  public static async getFeedStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await CommunityService.getFeedStats();
      sendSuccess(res, stats, "Feed statistics retrieved");
    } catch (err) {
      next(err);
    }
  }

  public static async getAdminPosts(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status, search, minReports } = req.query;
      const result = await CommunityService.getAdminPosts({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: status as any,
        search: search as string,
        minReports: minReports ? Number(minReports) : undefined
      });
      sendSuccess(res, result.posts, "Admin posts retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async moderatePost(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId =
        (req as any).admin?.adminId ||
        (req as any).admin?.id ||
        (req as any).admin?.userId ||
        "000000000000000000000000";
      const { action, reason } = req.body;
      const post = await CommunityService.moderatePost(adminId, req.params.id, action, reason);
      sendSuccess(res, post, `Post ${action.toLowerCase()}ed successfully`);
    } catch (err) {
      next(err);
    }
  }

  public static async getAdminReports(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status, reason, contentType, postId } = req.query;
      const result = await CommunityService.getAdminReports({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: status as any,
        reason: reason as any,
        contentType: contentType as any,
        postId: postId as any
      });
      sendSuccess(res, result.reports, "Admin reports retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async resolveReport(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId =
        (req as any).admin?.adminId ||
        (req as any).admin?.id ||
        (req as any).admin?.userId ||
        "000000000000000000000000";
      const report = await CommunityService.resolveReport(adminId, req.params.id, req.body);
      sendSuccess(res, report, `Report updated to ${report.status}`);
    } catch (err) {
      next(err);
    }
  }

  public static async getModerationHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search, action } = req.query;
      const result = await CommunityService.getModerationHistory({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string,
        action: action as string
      });
      sendSuccess(res, result.history, "Moderation history retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async getAdminComments(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search } = req.query;
      const result = await CommunityService.getAdminComments({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string
      });
      sendSuccess(res, result.comments, "Admin comments retrieved successfully", 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  public static async removeAdminComment(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId =
        (req as any).admin?.adminId ||
        (req as any).admin?.id ||
        (req as any).admin?.userId ||
        "000000000000000000000000";
      await CommunityService.deleteComment(adminId, req.params.id, true);
      sendSuccess(res, null, "Comment removed by admin");
    } catch (err) {
      next(err);
    }
  }
}
