import { Router } from "express";
import { ContentController } from "./content.controller";

const router = Router();

// Public routes for mobile and web client
router.get("/home", ContentController.getPublicHomeFeed);
router.get("/hero-banners", ContentController.getPublicBanners);
router.get("/home-sections", ContentController.getPublicSections);

export default router;
