import { Request, Response } from "express";
import newService from "../../services/new.service";
import storageService from "../../services/storage.service";
import instagramService from "../../services/instagram.service";
import iaService from "../../services/ai.service";
import { admin } from "../../config/firebase.admin";
import { firestoreApp } from "../../config/app.firebase";
import { mapFirebaseError } from "../../utils/firebase-error.util";

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
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para crear noticias en app-oficial-leon",
      notFoundMessage: "Recurso relacionado no encontrado",
      internalMessage: "Error al crear el noticia",
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

    await storageService.deleteFile(imageUrl);
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