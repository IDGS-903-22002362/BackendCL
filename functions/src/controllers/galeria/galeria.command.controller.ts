import { Request, Response } from "express";
import galleryService from "../../services/galeria.service";
//import storageAppService from "../../services/storageApp.service";
import { firestoreApp, storageAppOficial } from "../../config/app.firebase";
import { deleteGalleryImageSchema, deleteGalleryVideoSchema } from "../../middleware/validators/gallery.validator";
import { admin } from "../../config/firebase.admin";

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

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No se enviaron imágenes"
            });
        }

        const gallery = await galleryService.getById(id);

        if (!gallery) {
            return res.status(404).json({
                success: false,
                message: "Galería no encontrada"
            });
        }

        // 🔑 Usar Firebase Storage (ya autenticado)
        const bucket = storageAppOficial.bucket();

        const uploadPromises = files.map(async (file) => {
            const fileName = `galeria/${id}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const fileRef = bucket.file(fileName);

            // Subir archivo
            await fileRef.save(file.buffer, {
                metadata: {
                    contentType: file.mimetype,
                    metadata: {
                        uploadedBy: req.user?.uid || 'unknown',
                        galleryId: id,
                        originalName: file.originalname
                    }
                }
            });

            // Hacer público (opcional - para acceder directamente)
            await fileRef.makePublic();

            // Generar URL pública
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            return publicUrl;
        });

        const urls = await Promise.all(uploadPromises);

        // Actualizar Firestore
        const updated = [...gallery.imagenes, ...urls];
        await firestoreApp.collection("galeria").doc(id).update({
            imagenes: updated,
            updatedAt: admin.firestore.Timestamp.now()
        });

        return res.status(200).json({
            success: true,
            urls
        });

    } catch (error) {
        console.error("Error detallado al subir imágenes:", error);
        return res.status(500).json({
            success: false,
            message: "Error al subir imágenes",
            error: error instanceof Error ? error.message : "Error desconocido"
        });
    }
};

export const uploadVideos = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No se enviaron videos"
            });
        }

        const gallery = await galleryService.getById(id);

        if (!gallery) {
            return res.status(404).json({
                success: false,
                message: "Galería no encontrada"
            });
        }

        // 🔑 Usar Firebase Storage
        const bucket = storageAppOficial.bucket();

        const uploadPromises = files.map(async (file) => {
            // Sanitizar nombre del archivo
            const safeFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
            const fileName = `reels/${id}/${Date.now()}_${safeFileName}`;
            const fileRef = bucket.file(fileName);

            // Subir video
            await fileRef.save(file.buffer, {
                metadata: {
                    contentType: file.mimetype,
                    metadata: {
                        uploadedBy: req.user?.uid || 'unknown',
                        galleryId: id,
                        originalName: file.originalname
                    }
                }
            });

            // Hacer público
            await fileRef.makePublic();

            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            return publicUrl;
        });

        const urls = await Promise.all(uploadPromises);

        const updated = [...gallery.videos, ...urls];
        await firestoreApp.collection("galeria").doc(id).update({
            videos: updated,
            updatedAt: admin.firestore.Timestamp.now()
        });

        return res.status(200).json({
            success: true,
            urls
        });

    } catch (error) {
        console.error("Error detallado al subir videos:", error);
        return res.status(500).json({
            success: false,
            message: "Error al subir videos",
            error: error instanceof Error ? error.message : "Error desconocido"
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
export const deleteGallery = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params;

        // Llama al servicio que realiza el borrado lógico (estatus = false)
        await galleryService.delete(id);

        return res.json({
            success: true,
            message: "Galería eliminada correctamente (desactivada)",
        });
    } catch (error: any) {
        const statusCode = error.message.includes('no encontrada') ? 404 : 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "Error al eliminar la galería",
        });
    }
};

export const reactivate = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const galeriaReactivada = await galleryService.reactivateGallery(id);
        return res.status(200).json({
            success: true,
            message: 'Galeria reactivada exitosamente',
            data: galeriaReactivada,
        });
    } catch (error) {
        const statusCode = error instanceof Error && error.message.includes('no encontrado') ? 404 : 500;
        return res.status(statusCode).json({
            success: false,
            message: 'Error al reactivar la galeria',
            error: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
};
