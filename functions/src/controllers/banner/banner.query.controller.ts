import { Request, Response } from "express";
import bannerService from "../../services/banner.service";

export const getAll = async (req: Request, res: Response) => {
    try {
        const banners = await bannerService.getAllBanners();
        return res.json({ success: true, data: banners });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error al obtener banners" });
    }
};

export const getActive = async (req: Request, res: Response) => {
    try {
        const result = await bannerService.getActiveBannersWithResolvedProducts();
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error al obtener banners activos" });
    }
};

export const getById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const banner = await bannerService.getBannerById(id);
        if (!banner) return res.status(404).json({ success: false, message: "Banner no encontrado" });
        return res.json({ success: true, data: banner });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error al obtener banner" });
    }
};