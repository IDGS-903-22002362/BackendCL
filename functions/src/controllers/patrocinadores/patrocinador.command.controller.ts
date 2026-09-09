import { Request, Response } from "express";
import { PatrocinadorLogoVariante } from "../../models/patrocinadores.model";
import patrocinadorService from "../../services/patrocinador.service";
import storageAppService from "../../services/storageApp.service";
import { mapFirebaseError } from "../../utils/firebase-error.util";

const isLogoVariante = (value: unknown): value is PatrocinadorLogoVariante =>
  value === "blanca" || value === "negra" || value === "exclusiva";

const getUploadedFile = (req: Request): Express.Multer.File | undefined => {
  if (Array.isArray(req.files)) {
    return req.files[0];
  }

  return req.file;
};

const serializePatrocinador = (
  patrocinador: Awaited<
    ReturnType<typeof patrocinadorService.getPatrocinadorById>
  >,
) =>
  patrocinador
    ? patrocinadorService.serializePatrocinadorForApi(patrocinador)
    : null;

export const create = async (req: Request, res: Response) => {
  try {
    const nuevoPatrocinador = await patrocinadorService.createPatrocinador(
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Patrocinador creado exitosamente",
      data: serializePatrocinador(nuevoPatrocinador),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para crear patrocinadores",
      notFoundMessage: "Recurso relacionado no encontrado",
      internalMessage: "Error al crear el patrocinador",
    });

    console.error("Error en POST /api/patrocinadores:", {
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
    const patrocinadorActualizado = await patrocinadorService.updatePatrocinador(
      id,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Patrocinador actualizado exitosamente",
      data: serializePatrocinador(patrocinadorActualizado),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para actualizar patrocinadores",
      notFoundMessage: "Patrocinador no encontrado",
      internalMessage: "Error al actualizar el patrocinador",
    });

    console.error("Error en PUT /api/patrocinadores/:id:", {
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
    const { id, variante } = req.params;
    const file = getUploadedFile(req);

    if (!isLogoVariante(variante)) {
      return res.status(400).json({
        success: false,
        message: "La variante del logo debe ser blanca, negra o exclusiva",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No se envio ninguna imagen",
      });
    }

    const patrocinador = await patrocinadorService.getPatrocinadorById(id);
    if (!patrocinador) {
      return res.status(404).json({
        success: false,
        message: `Patrocinador con ID ${id} no encontrado`,
      });
    }

    const url = await storageAppService.uploadFile(
      file.buffer,
      file.originalname,
      "patrocinadores",
      file.mimetype,
    );

    const { patrocinador: actualizado, previousImagen } =
      await patrocinadorService.updatePatrocinadorImagen(id, url, variante);

    if (previousImagen) {
      await storageAppService.deleteFile(previousImagen).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      message: `Logo ${variante} subido exitosamente`,
      data: {
        url,
        variante,
        patrocinador: serializePatrocinador(actualizado),
      },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para subir imagen de patrocinadores",
      notFoundMessage: "Patrocinador no encontrado",
      internalMessage: "Error al subir la imagen del patrocinador",
    });

    console.error("Error en POST /api/patrocinadores/:id/imagen/:variante:", {
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
    const { id, variante } = req.params;

    if (!isLogoVariante(variante)) {
      return res.status(400).json({
        success: false,
        message: "La variante del logo debe ser blanca, negra o exclusiva",
      });
    }

    const patrocinador = await patrocinadorService.getPatrocinadorById(id);

    if (!patrocinador) {
      return res.status(404).json({
        success: false,
        message: `Patrocinador con ID ${id} no encontrado`,
      });
    }

    const { patrocinador: actualizado, previousImagen } =
      await patrocinadorService.clearPatrocinadorImagen(id, variante);

    if (previousImagen) {
      await storageAppService.deleteFile(previousImagen).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      message: `Logo ${variante} eliminado exitosamente`,
      data: serializePatrocinador(actualizado),
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar imagen de patrocinadores",
      notFoundMessage: "Patrocinador no encontrado",
      internalMessage: "Error al eliminar la imagen del patrocinador",
    });

    console.error("Error en DELETE /api/patrocinadores/:id/imagen/:variante:", {
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
    await patrocinadorService.deletePatrocinador(id);

    return res.status(200).json({
      success: true,
      message: "Patrocinador desactivado exitosamente",
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para desactivar patrocinadores",
      notFoundMessage: "Patrocinador no encontrado",
      internalMessage: "Error al desactivar el patrocinador",
    });

    console.error("Error en DELETE /api/patrocinadores/:id:", {
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
    const patrocinador = await patrocinadorService.getPatrocinadorById(id);

    if (!patrocinador) {
      return res.status(404).json({
        success: false,
        message: `Patrocinador con ID ${id} no encontrado`,
      });
    }

    const mediaUrls =
      await patrocinadorService.permanentlyDeletePatrocinador(id);

    await Promise.all(
      mediaUrls.map((url) =>
        storageAppService.deleteFile(url).catch(() => undefined),
      ),
    );

    return res.status(200).json({
      success: true,
      message: "Patrocinador eliminado permanentemente",
      data: { id, deletedMediaCount: mediaUrls.length },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar patrocinadores",
      notFoundMessage: "Patrocinador no encontrado",
      internalMessage: "Error al eliminar permanentemente el patrocinador",
    });

    console.error("Error en DELETE /api/patrocinadores/:id/permanente:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};
