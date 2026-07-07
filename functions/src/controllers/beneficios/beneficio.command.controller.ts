import { Request, Response } from "express";
import beneficioService from "../../services/beneficio.service";
import storageAppService from "../../services/storageApp.service";
import { mapFirebaseError } from "../../utils/firebase-error.util";

const getUploadedImage = (req: Request): Express.Multer.File | undefined => {
  if (req.file) {
    return req.file;
  }

  if (Array.isArray(req.files)) {
    return req.files[0];
  }

  return undefined;
};

export const create = async (req: Request, res: Response) => {
  try {
    const beneficioData = req.body;
    const nuevoBeneficio = await beneficioService.createBeneficio(beneficioData);

    return res.status(201).json({
      success: true,
      message: "Beneficio creado exitosamente",
      data: nuevoBeneficio,
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
      data: beneficioActualizado,
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

export const uploadImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const file = getUploadedImage(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No se envio una imagen",
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

    const beneficioActualizado = await beneficioService.updateBeneficio(id, {
      imagen: url,
    });

    return res.status(200).json({
      success: true,
      message: "Imagen subida exitosamente",
      data: { url, beneficio: beneficioActualizado },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para subir imagenes de beneficios",
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

export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await beneficioService.deleteBeneficio(id);

    return res.status(200).json({
      success: true,
      message: "Beneficio eliminado exitosamente",
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al eliminar el beneficio",
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