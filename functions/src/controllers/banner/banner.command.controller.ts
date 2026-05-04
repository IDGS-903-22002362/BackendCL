import { Request, Response } from "express";
import bannerService from "../../services/banner.service";
import storageService from "../../services/storage.service";
import { promises as fs } from "fs";

export const create = async (req: Request, res: Response) => {
    try {
        console.log("SI LLEGO", req.body);
        const newBanner = await bannerService.createBanner(req.body);
        return res.status(201).json({ success: true, data: newBanner });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error al crear banner" });
    }
};

export const update = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updated = await bannerService.updateBanner(id, req.body);
        return res.json({ success: true, data: updated });
    } catch (error: any) {
        const status = error.message.includes("no encontrado") ? 404 : 500;
        return res.status(status).json({ success: false, message: error.message });
    }
};

export const remove = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await bannerService.deleteBanner(id);
        return res.json({ success: true, message: "Banner eliminado" });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error al eliminar banner" });
    }
};

export const uploadBackgroundImage = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ success: false, message: "No se envió imagen" });
    }
    try {
        const { id } = req.params;
        const banner = await bannerService.getBannerById(id);
        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner no encontrado" });
        }


        const imageUrl = await storageService.uploadFileFromPath(
            file.path,
            `banners/${id}/background_${Date.now()}`,
            file.mimetype
        );
        await bannerService.updateBanner(id, { backgroundImage: imageUrl });
        return res.json({ success: true, data: { url: imageUrl } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Error al subir imagen" });
    } finally {
        if (file.path) await fs.unlink(file.path);
    }
};

export const uploadVideo = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ success: false, message: "No se envió vídeo" });
    }
    try {
        const { id } = req.params;
        const banner = await bannerService.getBannerById(id);
        if (!banner) {
            return res.status(404).json({ success: false, message: "Banner no encontrado" });
        }

        const videoUrl = await storageService.uploadFileFromPath(
            file.path,
            `banners/${id}/video_${Date.now()}`,
            file.mimetype
        );
        await bannerService.updateBanner(id, { videoUrl });
        return res.json({ success: true, data: { url: videoUrl } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Error al subir vídeo" });
    } finally {
        if (file.path) await fs.unlink(file.path);
    }
};