import { Request, Response } from "express";
import newService from "../../services/new.service";
import storageAppService from "../../services/storageApp.service";
import instagramService from "../../services/instagram.service";
import { firestoreApp } from "../../config/app.firebase";
import { mapFirebaseError } from "../../utils/firebase-error.util";

/**
 * Controller: Products Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
  try {
    const noticiaData = req.body;
    const usuarioId = req.user?.uid;
    const autorNombre = req.user?.nombre; // Asegúrate que el token incluya 'nombre'
    console.log("Usuario autenticado en create:", {
      uid: usuarioId,
      nombre: autorNombre,
    });

    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
      });
    }

    const nuevaNoticia = await newService.createNew(noticiaData, usuarioId, autorNombre);

    return res.status(201).json({
      success: true,
      message: "Noticia creada exitosamente",
      data: nuevaNoticia,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para crear noticias",
      notFoundMessage: "Recurso relacionado no encontrado",
      internalMessage: "Error al crear la noticia",
    });
    console.error("Error en POST /api/noticias:", {
      code: mapped.code,
      status: mapped.status,
    });
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const noticiaActualizado = await newService.updateNew(id, updateData);

    return res.status(200).json({
      success: true,
      message: "Noticia actualizada exitosamente",
      data: noticiaActualizado,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para actualizar noticias",
      notFoundMessage: "Noticia no encontrada",
      internalMessage: "Error al actualizar la noticia",
    });

    console.error("Error en PUT /api/noticias/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
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
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar noticias",
      notFoundMessage: "Noticia no encontrada",
      internalMessage: "Error al eliminar la noticia",
    });

    console.error("Error en DELETE /api/noticias/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
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

    const urls = await storageAppService.uploadMultipleFiles(
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
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para subir imágenes",
      notFoundMessage: "Noticia no encontrada",
      internalMessage: "Error al subir las imágenes",
    });

    console.error("Error en POST /api/noticias/:id/imagenes:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
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

    await storageAppService.deleteFile(imageUrl);
    const imagenesActualizadas = imagenes.filter((url) => url !== imageUrl);
    await newService.updateNew(id, { imagenes: imagenesActualizadas });

    return res.status(200).json({
      success: true,
      message: "Imagen eliminada exitosamente",
      data: { imagenesRestantes: imagenesActualizadas.length },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar imágenes",
      notFoundMessage: "Imagen o noticia no encontrada",
      internalMessage: "Error al eliminar la imagen",
    });

    console.error("Error en DELETE /api/productos/:id/imagenes:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};
export const like = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Usuario no autenticado" });
    }

    const result = await newService.toggleLikeNoticia(id, userId);

    return res.status(200).json({
      success: true,
      liked: result.liked,
      likes: result.likes,
    });
  } catch (error) {
    console.error("❌ Error en like:", error);
    return res.status(500).json({
      success: false,
      message: "Error al procesar like",
    });
  }
};

export const generarIA = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Agregamos un retorno de la data generada para que el front sepa qué pasó
    const resultado = await newService.generarIAParaNoticia(id);

    return res.status(200).json({
      success: true,
      message: "Contenido IA generado correctamente",
      data: resultado // Opcional: enviar el resumen generado
    });
  } catch (error: any) {
    console.error("Error en generarIA:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error al procesar con IA",
    });
  }
};

export const syncInstagramNoticias = async (_req: Request, res: Response) => {
  try {
    //Cambio con respecto a la nueva API
    // 1. Usamos el servicio centralizado que ya mapea todo a STRING
    const postsMapeados = await instagramService.obtenerPublicaciones();

    const batch = firestoreApp.batch();
    const noticiasRef = firestoreApp.collection("noticias");

    for (const data of postsMapeados) {
      // Omitimos si no hay contenido (por seguridad)
      if (!data.contenido) continue;

      const docRef = noticiasRef.doc(data.id);

      // 2. Insertamos el objeto 'data' tal cual viene del servicio
      // Esto asegura que createdAt sea String y existan todos los campos
      batch.set(docRef, data, { merge: true });
    }

    await batch.commit();

    return res.json({
      success: true,
      message: "Sincronización completada con formato unificado",
      count: postsMapeados.length
    });
  } catch (error) {
    // Agregamos todas las propiedades que tu interfaz ErrorMappingOptions exige
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado para sincronizar",
      forbiddenMessage: "Sin permisos para esta operación",
      notFoundMessage: "No se encontraron publicaciones",
      internalMessage: "Error en sincronización de Instagram",
    });

    console.error("Sync Instagram error:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const reactivate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const noticiaReactivada = await newService.reactivateNew(id);
    return res.status(200).json({
      success: true,
      message: 'Noticia reactivada exitosamente',
      data: noticiaReactivada,
    });
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('no encontrado') ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      message: 'Error al reactivar la noticia',
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
};