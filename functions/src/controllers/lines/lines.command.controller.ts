import { Request, Response } from "express";
import { promises as fs } from "fs";
import lineService from "../../services/line.service";
import storageService from "../../services/storage.service";

/**
 * Controller: Products Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
  try {
    // Body ya validado por middleware de Zod
    const lineaData = req.body;

    const nuevaLinea = await lineService.createLine(lineaData);

    return res.status(201).json({
      success: true,
      message: "Linea creado exitosamente",
      data: nuevaLinea,
    });
  } catch (error) {
    console.error("Error en POST /api/lineas:", error);
    return res.status(500).json({
      success: false,
      message: "Error al crear la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const lineaActualizada = await lineService.updateLine(id, updateData);

    return res.status(200).json({
      success: true,
      message: "linea actualizada exitosamente",
      data: lineaActualizada,
    });
  } catch (error) {
    console.error("Error en PUT /api/lines/:id:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;
    return res.status(statusCode).json({
      success: false,
      message: "Error al actualizar la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const uploadImage = async (req: Request, res: Response) => {
  const file = req.file || ((req.files as Express.Multer.File[]) || [])[0];

  try {
    const { id } = req.params;

    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "No se envio imagen" });
    }

    const linea = await lineService.getLineById(id);
    if (!linea) {
      return res.status(404).json({
        success: false,
        message: `Linea con ID ${id} no encontrado`,
      });
    }

    const imageUrl = await storageService.uploadFileFromPath(
      file.path,
      file.originalname,
      "lineas",
      file.mimetype,
    );
    const lineaActualizada = await lineService.updateLine(id, {
      imagenPrincipal: imageUrl,
    });

    return res.status(200).json({
      success: true,
      message: "Imagen principal de linea actualizada exitosamente",
      data: { url: imageUrl, linea: lineaActualizada },
    });
  } catch (error) {
    console.error("Error en POST /api/lineas/:id/imagen:", error);
    return res.status(500).json({
      success: false,
      message: "Error al subir la imagen principal de la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  } finally {
    if (file?.path) {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }
};

export const deleteImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const linea = await lineService.getLineById(id);

    if (!linea) {
      return res.status(404).json({
        success: false,
        message: `Linea con ID ${id} no encontrado`,
      });
    }

    if (linea.imagenPrincipal?.includes("storage.googleapis.com")) {
      await storageService.deleteFile(linea.imagenPrincipal);
    }

    const lineaActualizada = await lineService.updateLine(id, {
      imagenPrincipal: null,
    });

    return res.status(200).json({
      success: true,
      message: "Imagen principal de linea eliminada exitosamente",
      data: lineaActualizada,
    });
  } catch (error) {
    console.error("Error en DELETE /api/lineas/:id/imagen:", error);
    return res.status(500).json({
      success: false,
      message: "Error al eliminar la imagen principal de la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await lineService.deleteLine(id);
    return res.status(200).json({
      success: true,
      message: "Line eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error en DELETE /api/lineas/:id:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;
    return res.status(statusCode).json({
      success: false,
      message: "Error al eliminar la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
