import { Request, Response, NextFunction } from "express";
import { ContentService } from "./content.service";
import { sendSuccess } from "../../utils/response";

export class ContentController {
  // ==========================================
  // Public Feed Controllers
  // ==========================================

  public static async getPublicHomeFeed(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const feed = await ContentService.getPublicHomeFeed();
      sendSuccess(res, feed, "Home feed retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getPublicBanners(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const banners = await ContentService.getAllBanners(false);
      sendSuccess(res, banners, "Active hero banners retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getPublicSections(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sections = await ContentService.getAllSections(false);
      sendSuccess(res, sections, "Active home sections retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // Admin Banner Controllers
  // ==========================================

  public static async getAllBanners(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const banners = await ContentService.getAllBanners(true);
      sendSuccess(res, banners, "Banners retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async createBanner(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const banner = await ContentService.createBanner(req.body);
      sendSuccess(res, banner, "Hero banner created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async updateBanner(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const banner = await ContentService.updateBanner(req.params.id, req.body);
      sendSuccess(res, banner, "Hero banner updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async deleteBanner(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await ContentService.deleteBanner(req.params.id);
      sendSuccess(res, null, "Hero banner deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async reorderBanners(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await ContentService.reorderBanners(req.body.orderedIds);
      sendSuccess(res, null, "Hero banners reordered successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // Admin Home Section Controllers
  // ==========================================

  public static async getAllSections(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sections = await ContentService.getAllSections(true);
      sendSuccess(res, sections, "Home sections retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getSectionById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const section = await ContentService.getSectionById(req.params.id);
      sendSuccess(res, section, "Home section retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async createSection(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const section = await ContentService.createSection(req.body);
      sendSuccess(res, section, "Home section created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async updateSection(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const section = await ContentService.updateSection(req.params.id, req.body);
      sendSuccess(res, section, "Home section updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async updateSectionItems(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const section = await ContentService.updateSectionItems(
        req.params.id,
        req.body.items || []
      );
      sendSuccess(res, section, "Section items updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async deleteSection(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await ContentService.deleteSection(req.params.id);
      sendSuccess(res, null, "Home section deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async reorderSections(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await ContentService.reorderSections(req.body.orderedIds);
      sendSuccess(res, null, "Home sections reordered successfully");
    } catch (error) {
      next(error);
    }
  }
}
