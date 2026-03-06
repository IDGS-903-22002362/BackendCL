import { Request, Response } from "express";
import newService from "../../services/new.service";
import { firestoreApp } from "../../config/app.firebase";

/**
 * Controller: Products Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de datos (GET)
 */
export const getAll = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.uid; // Obtén el ID del usuario autenticado
        console.log("ID de usuario detectado en getAll:", userId);
        const noticias = await newService.getAllNews();

        // Para cada noticia, verificar si el usuario actual le ha dado like
        const noticiasConLike = await Promise.all(
            noticias.map(async (noticia) => {
                let liked = false;
                if (userId) {
                    const likeRef = firestoreApp
                        .collection("noticias")
                        .doc(noticia.id)
                        .collection("likesUsers")
                        .doc(userId);
                    const likeDoc = await likeRef.get();
                    liked = likeDoc.exists;
                }
                return {
                    ...noticia,
                    liked,           // ← Nuevo campo
                    likesCount: noticia.likes, // Opcional: renombrar para consistencia
                };
            })
        );

        res.status(200).json({
            success: true,
            count: noticiasConLike.length,
            data: noticiasConLike,
        });
    } catch (error) {
        console.error("Error en GET /api/noticias:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener las noticias",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const getById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const noticia = await newService.getNewsById(id);

        if (!noticia) {
            return res.status(404).json({
                success: false,
                message: `Noticia con ID ${id} no encontrado`,
            });
        }

        return res.status(200).json({
            success: true,
            data: noticia,
        });
    } catch (error) {
        console.error("Error en GET /api/noticias/:id:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener el noticia",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const search = async (req: Request, res: Response) => {
    try {
        const { termino } = req.params;
        const noticias = await newService.searchNews(termino);

        res.status(200).json({
            success: true,
            count: noticias.length,
            data: noticias,
        });
    } catch (error) {
        console.error("Error en GET /api/noticias/buscar/:termino:", error);
        res.status(500).json({
            success: false,
            message: "Error al buscar noticias",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
