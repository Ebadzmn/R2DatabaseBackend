import { Router } from "express";
import { ContentController } from "./content.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";

const router = Router();

// ==========================================
// Admin Hero Banners Routes
// ==========================================
router.get("/banners", authenticateAdmin, ContentController.getAllBanners);
router.post("/banners", authenticateAdmin, ContentController.createBanner);
router.put("/banners/reorder", authenticateAdmin, ContentController.reorderBanners);
router.put("/banners/:id", authenticateAdmin, ContentController.updateBanner);
router.delete("/banners/:id", authenticateAdmin, ContentController.deleteBanner);

// ==========================================
// Admin Home Sections Routes
// ==========================================
router.get("/home-sections", authenticateAdmin, ContentController.getAllSections);
router.post("/home-sections", authenticateAdmin, ContentController.createSection);
router.put("/home-sections/reorder", authenticateAdmin, ContentController.reorderSections);
router.get("/home-sections/:id", authenticateAdmin, ContentController.getSectionById);
router.put("/home-sections/:id", authenticateAdmin, ContentController.updateSection);
router.put("/home-sections/:id/items", authenticateAdmin, ContentController.updateSectionItems);
router.delete("/home-sections/:id", authenticateAdmin, ContentController.deleteSection);

export default router;
