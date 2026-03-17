import { Request, Response } from "express";
import galleryService from "../../services/galeria.service";
import storageService from "../../services/storage.service";
import { firestoreApp } from "../../config/app.firebase";
import { deleteGalleryImageSchema, deleteGalleryVideoSchema } from "../../middleware/validators/gallery.validator";

export const create = async (req: Request, res: Response): Promise<Response> => {
    try {

        const data = req.body;

        const usuarioId = req.user?.uid;
        const autorNombre = req.user?.nombre;

        if (!usuarioId) {
            return res.status(401).json({
                success: false,
                message: "Usuario no autenticado"
            });
        }

        const gallery = await galleryService.create(data, usuarioId, autorNombre);

        return res.status(201).json({
            success: true,
            data: gallery
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: "Error al crear galería"
        });

    }
};

export const uploadImages = async (req: Request, res: Response): Promise<Response> => {

    try {

        const { id } = req.params;

        const files = req.files as Express.Multer.File[];

        const gallery = await galleryService.getById(id);

        if (!gallery) {
            return res.status(404).json({
                success: false,
                message: "Galería no encontrada"
            });
        }

        const imagesData = files.map(file => ({
            buffer: file.buffer,
            originalName: file.originalname
        }));

        const urls = await storageService.uploadMultipleFiles(
            imagesData,
            "galeria"
        );

        const updated = [...gallery.imagenes, ...urls];

        await firestoreApp.collection("galeria").doc(id).update({
            imagenes: updated
        });

        return res.status(200).json({
            success: true,
            urls
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: "Error al subir imágenes"
        });

    }

};

export const uploadVideos = async (req: Request, res: Response): Promise<Response> => {

    try {

        const { id } = req.params;

        const files = req.files as Express.Multer.File[];

        const gallery = await galleryService.getById(id);

        if (!gallery) {
            return res.status(404).json({
                success: false,
                message: "Galería no encontrada"
            });
        }

        const videosData = files.map(file => ({
            buffer: file.buffer,
            originalName: file.originalname
        }));

        const urls = await storageService.uploadMultipleFiles(
            videosData,
            "reels"
        );

        const updated = [...gallery.videos, ...urls];

        await firestoreApp.collection("galeria").doc(id).update({
            videos: updated
        });

        return res.status(200).json({
            success: true,
            urls
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: "Error al subir videos"
        });

    }

};

export const deleteImage = async (req: Request, res: Response): Promise<Response> => {
    try {

        const { id } = req.params;

        const parsed = deleteGalleryImageSchema.parse(req.body);

        await galleryService.deleteImage(id, parsed.imageUrl);

        return res.json({
            success: true,
            message: "Imagen eliminada correctamente",
        });

    } catch (error: any) {

        return res.status(400).json({
            success: false,
            message: error.message,
        });

    }
};

export const deleteVideo = async (req: Request, res: Response): Promise<Response> => {
    try {

        const { id } = req.params;

        const parsed = deleteGalleryVideoSchema.parse(req.body);

        await galleryService.deleteVideo(id, parsed.videoUrl);

        return res.json({
            success: true,
            message: "Video eliminado correctamente",
        });

    } catch (error: any) {

        return res.status(400).json({
            success: false,
            message: error.message,
        });

    }
};