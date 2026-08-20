import { Request, Response } from "express";
import beneficioService from "../../services/beneficio.service";
import storageAppService from "../../services/storageApp.service";
import { mapFirebaseError } from "../../utils/firebase-error.util";
import { BeneficioMediaTipo } from "../../models/beneficios.model";

const getUploadedFiles = (req: Request): Express.Multer.File[] => {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (req.file) {
    return [req.file];
  }

  return [];
};

const serializeBeneficio = (beneficio: Awaited<
  ReturnType<typeof beneficioService.getBeneficioById>
>) => (beneficio ? beneficioService.serializeBeneficioForApi(beneficio) : null);

const getUploadedFile = (req: Request): Express.Multer.File | undefined => {
  return getUploadedFiles(req)[0];
};

export const create = async (req: Request, res: Response) => {
  try {
    const beneficioData = req.body;
    const nuevoBeneficio = await beneficioService.createBeneficio(beneficioData);

    return res.status(201).json({
      success: true,
      message: "Beneficio creado exitosamente",
      data: serializeBeneficio(nuevoBeneficio),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para crear beneficios",
      notFoundMessage: "Recurso relacionado no encontrado",
      internalMessage: "Error al crear el beneficio",
    });

    console.error("Error en POST /api/beneficios:", {
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
    const beneficioActualizado = await beneficioService.updateBeneficio(
      id,
      updateData,
    );

    return res.status(200).json({
      success: true,
      message: "Beneficio actualizado exitosamente",
      data: serializeBeneficio(beneficioActualizado),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para actualizar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al actualizar el beneficio",
    });

    console.error("Error en PUT /api/beneficios/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

const uploadMedia = async (
  req: Request,
  res: Response,
  mediaTipo: BeneficioMediaTipo,
  emptyMessage: string,
  successMessage: string,
  internalMessage: string,
) => {
  try {
    const { id } = req.params;
    const file = getUploadedFile(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: emptyMessage,
      });
    }

    const beneficio = await beneficioService.getBeneficioById(id);
    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const url = await storageAppService.uploadFile(
      file.buffer,
      file.originalname,
      "beneficios",
      file.mimetype,
    );

    const beneficioActualizado = await beneficioService.updateBeneficioMedia(
      id,
      mediaTipo,
      url,
    );

    return res.status(200).json({
      success: true,
      message: successMessage,
      data: {
        url,
        beneficio: serializeBeneficio(beneficioActualizado),
      },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para subir media de beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage,
    });

    console.error(`Error en POST /api/beneficios/:id/media (${mediaTipo}):`, {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const uploadImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const files = getUploadedFiles(req);

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se envio ninguna imagen",
      });
    }

    const beneficio = await beneficioService.getBeneficioById(id);
    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const urls: string[] = [];
    for (const file of files) {
      const url = await storageAppService.uploadFile(
        file.buffer,
        file.originalname,
        "beneficios",
        file.mimetype,
      );
      urls.push(url);
    }

    const beneficioActualizado = await beneficioService.appendBeneficioImagenes(
      id,
      urls,
    );

    return res.status(200).json({
      success: true,
      message:
        urls.length === 1
          ? "Imagen subida exitosamente"
          : "Imagenes subidas exitosamente",
      data: {
        urls,
        beneficio: serializeBeneficio(beneficioActualizado),
      },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para subir media de beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al subir la imagen del beneficio",
    });

    console.error("Error en POST /api/beneficios/:id/imagen:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const uploadVideo = async (req: Request, res: Response) => {
  return uploadMedia(
    req,
    res,
    "video",
    "No se envio un video",
    "Video subido exitosamente",
    "Error al subir el video del beneficio",
  );
};

export const removeMedia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const beneficio = await beneficioService.getBeneficioById(id);

    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const mediaUrls = beneficioService.collectMediaUrls(beneficio);

    const beneficioActualizado = await beneficioService.clearBeneficioMedia(id);

    await Promise.all(
      mediaUrls.map((url) =>
        storageAppService.deleteFile(url).catch(() => undefined),
      ),
    );

    return res.status(200).json({
      success: true,
      message: "Media eliminada exitosamente",
      data: serializeBeneficio(beneficioActualizado),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar media de beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al eliminar la media del beneficio",
    });

    console.error("Error en DELETE /api/beneficios/:id/media:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const removeImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { url } = req.body as { url?: string };

    if (!url?.trim()) {
      return res.status(400).json({
        success: false,
        message: "La URL de la imagen es obligatoria",
      });
    }

    const beneficio = await beneficioService.getBeneficioById(id);
    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const beneficioActualizado = await beneficioService.removeBeneficioImagen(
      id,
      url,
    );

    await storageAppService.deleteFile(url).catch(() => undefined);

    return res.status(200).json({
      success: true,
      message: "Imagen eliminada exitosamente",
      data: serializeBeneficio(beneficioActualizado),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar media de beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al eliminar la imagen del beneficio",
    });

    console.error("Error en DELETE /api/beneficios/:id/imagen:", {
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
    await beneficioService.deleteBeneficio(id);

    return res.status(200).json({
      success: true,
      message: "Beneficio desactivado exitosamente",
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para desactivar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al desactivar el beneficio",
    });

    console.error("Error en DELETE /api/beneficios/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const destroyPermanently = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const beneficio = await beneficioService.getBeneficioById(id);

    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const mediaUrls = await beneficioService.permanentlyDeleteBeneficio(id);

    await Promise.all(
      mediaUrls.map((url) =>
        storageAppService.deleteFile(url).catch(() => undefined),
      ),
    );

    return res.status(200).json({
      success: true,
      message: "Beneficio eliminado permanentemente",
      data: { id, deletedMediaCount: mediaUrls.length },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al eliminar permanentemente el beneficio",
    });

    console.error("Error en DELETE /api/beneficios/:id/permanente:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const claimPoints = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const memberId = req.user!.uid;
    const result = await beneficioService.claimBeneficioPoints(id, memberId);

    return res.status(200).json({
      success: true,
      message: result.alreadyClaimed
        ? "Ya reclamaste los puntos de este beneficio"
        : "Puntos reclamados exitosamente",
      data: {
        ...result,
        puntosActuales: result.puntosActuales,
        puntosAsignados: result.puntosAsignados,
      },
      puntos: result.puntosActuales,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para reclamar este beneficio",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al reclamar puntos del beneficio",
    });

    console.error("Error en POST /api/beneficios/:id/reclamar:", {
      code: mapped.code,
      status: mapped.status,
    });

    const message =
      error instanceof Error &&
      mapped.message === "Error al reclamar puntos del beneficio"
        ? error.message
        : mapped.message;

    return res.status(mapped.status).json({
      success: false,
      message,
    });
  }
};
