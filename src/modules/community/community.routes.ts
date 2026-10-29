import { Router } from "express";
import { CommunityController } from "./community.controller";
import { authenticateUser, optionalAuthenticateUser } from "../../middleware/app-auth.middleware";
import { authenticateAdmin } from "../../middleware/auth.middleware";

// End-User Mobile Community Routes
const communityRouter = Router();

communityRouter.get("/feed", optionalAuthenticateUser, CommunityController.getFeed);
communityRouter.get("/posts/:id", optionalAuthenticateUser, CommunityController.getPostById);
communityRouter.post("/posts", authenticateUser, CommunityController.createPost);
communityRouter.put("/posts/:id", authenticateUser, CommunityController.updatePost);
communityRouter.delete("/posts/:id", authenticateUser, CommunityController.deletePost);
communityRouter.post("/posts/:id/like", authenticateUser, CommunityController.toggleLike);
communityRouter.get("/posts/:id/comments", optionalAuthenticateUser, CommunityController.getComments);
communityRouter.post("/posts/:id/comments", authenticateUser, CommunityController.addComment);
communityRouter.delete("/comments/:id", authenticateUser, CommunityController.deleteComment);
communityRouter.post("/reports", authenticateUser, CommunityController.reportContent);
communityRouter.get("/my-reports", authenticateUser, CommunityController.getMyReports);
communityRouter.get("/users/:id", optionalAuthenticateUser, CommunityController.getUserProfile);
communityRouter.post("/upload", authenticateUser, CommunityController.uploadImages);

// Admin Community Moderation Routes
const adminCommunityRouter = Router();

adminCommunityRouter.use(authenticateAdmin);

adminCommunityRouter.get("/stats", CommunityController.getFeedStats);
adminCommunityRouter.get("/posts", CommunityController.getAdminPosts);
adminCommunityRouter.patch("/posts/:id/moderate", CommunityController.moderatePost);
adminCommunityRouter.delete("/posts/:id", CommunityController.deletePost);
adminCommunityRouter.get("/reports", CommunityController.getAdminReports);
adminCommunityRouter.patch("/reports/:id/resolve", CommunityController.resolveReport);
adminCommunityRouter.get("/history", CommunityController.getModerationHistory);
adminCommunityRouter.get("/comments", CommunityController.getAdminComments);
adminCommunityRouter.delete("/comments/:id", CommunityController.removeAdminComment);

export { communityRouter, adminCommunityRouter };
