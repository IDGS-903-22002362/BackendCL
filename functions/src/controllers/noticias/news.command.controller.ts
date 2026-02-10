import { Request, Response } from "express";
import newService from "../../services/new.service";
import storageService from "../../services/storage.service";
import instagramService from "../../services/instagram.service";
import iaService from "../../services/ai.service";
import { admin } from "../../config/firebase.admin";


/**
 * Controller: Products Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
    try {
        // Body ya validado por middleware de Zod
        const noticiaData = req.body;

        const nuevaNoticia = await newService.createNew(noticiaData);

        return res.status(201).json({
            success: true,
            message: "Noticia creada exitosamente",
            data: nuevaNoticia,
        });
    } catch (error) {
        console.error("Error en POST /api/noticias:", error);
        return res.status(500).json({
            success: false,
            message: "Error al crear el noticia",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const update = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const noticiaActualizado = await newService.updateNew(
            id,
            updateData,
        );

        return res.status(200).json({
            success: true,
            message: "Noticia actualizada exitosamente",
            data: noticiaActualizado,
        });
    } catch (error) {
        console.error("Error en PUT /api/noticias/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al actualizar la noticia",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const remove = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await newService.deleteNew(id);
        return res.status(200).json({
            success: true,
            message: "Noticia eliminada exitosamente",
        });
    } catch (error) {
        console.error("Error en DELETE /api/noticias/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al eliminar la noticia",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const uploadImages = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res
                .status(400)
                .json({ success: false, message: "No se enviaron archivos" });
        }

        const noticia = await newService.getNewsById(id);
        if (!noticia) {
            return res.status(404).json({
                success: false,
                message: `Noticia con ID ${id} no encontrado`,
            });
        }

        const imagenesData = files.map((file) => ({
            buffer: file.buffer,
            originalName: file.originalname,
        }));

        const urls = await storageService.uploadMultipleFiles(
            imagenesData,
            "noticias",
        );
        const imagenesActuales = noticia.imagenes || [];
        const imagenesActualizadas = [...imagenesActuales, ...urls];

        await newService.updateNew(id, { imagenes: imagenesActualizadas });

        return res.status(200).json({
            success: true,
            message: `${urls.length} imagen(es) subida(s) exitosamente`,
            data: { urls, totalImagenes: imagenesActualizadas.length },
        });
    } catch (error) {
        console.error("Error en POST /api/noticias/:id/imagenes:", error);
        return res.status(500).json({
            success: false,
            message: "Error al subir las imágenes",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const deleteImage = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({
                success: false,
                message: "Se requiere la URL de la imagen a eliminar",
            });
        }

        const noticia = await newService.getNewsById(id);
        if (!noticia) {
            return res.status(404).json({
                success: false,
                message: `Noticia con ID ${id} no encontrado`,
            });
        }

        const imagenes = noticia.imagenes || [];
        if (!imagenes.includes(imageUrl)) {
            return res.status(404).json({
                success: false,
                message: "La imagen no existe en este producto",
            });
        }

        await storageService.deleteFile(imageUrl);
        const imagenesActualizadas = imagenes.filter((url) => url !== imageUrl);
        await newService.updateNew(id, { imagenes: imagenesActualizadas });

        return res.status(200).json({
            success: true,
            message: "Imagen eliminada exitosamente",
            data: { imagenesRestantes: imagenesActualizadas.length },
        });
    } catch (error) {
        console.error("Error en DELETE /api/productos/:id/imagenes:", error);
        return res.status(500).json({
            success: false,
            message: "Error al eliminar la imagen",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const generarIA = async (req: Request, res: Response) => {
    const { id } = req.params;

    await newService.generarIAParaNoticia(id);

    res.status(200).json({
        success: true,
        message: "Contenido IA generado correctamente",
    });
};

export const syncInstagramNoticias = async (_req: Request, res: Response) => {
    try {
        const posts = await instagramService.obtenerPublicaciones();

        const batch = admin.firestore().batch();
        const noticiasRef = admin.firestore().collection("noticias");

        for (const post of posts) {
            if (!post.caption) continue;

            const ia = await iaService.generarContenidoIA(post.caption);

            const docRef = noticiasRef.doc(`ig_${post.id}`);

            batch.set(docRef, {
                titulo: ia?.tituloIA ?? "Publicación de Instagram",
                descripcion: "Instagram",
                contenido: post.caption,
                imagenes: post.media_url ? [post.media_url] : [],
                origen: "instagram",
                enlaceExterno: post.permalink,
                ia,
                estatus: true,
                createdAt: admin.firestore.Timestamp.fromDate(
                    new Date(post.timestamp)
                ),
                updatedAt: admin.firestore.Timestamp.now(),
            });
        }

        await batch.commit();

        res.json({ success: true, count: posts.length });
    } catch (error) {
        console.error("Sync Instagram error:", error);
        res.status(500).json({ success: false });
    }
};
