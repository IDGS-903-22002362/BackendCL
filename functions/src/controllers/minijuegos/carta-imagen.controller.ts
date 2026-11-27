import { promises as fs } from "fs";
import { NextFunction, Request, Response } from "express";
import { parseMultipartImages } from "../../middleware/multipart.middleware";
import {
  CARTA_IMAGEN_ALLOWED_MIME_TYPES,
  CARTA_IMAGEN_MAX_BYTES,
  CartaImagenError,
  subirCartaImagen,
} from "../../services/carta-imagen.service";
import { ApiError } from "../../utils/api-error";

const CARTA_IMAGEN_FIELD = "imagen";

const parseImagen = parseMultipartImages({
  fieldName: CARTA_IMAGEN_FIELD,
  maxFiles: 1,
  maxFileSizeBytes: CARTA_IMAGEN_MAX_BYTES,
  allowedMimeTypes: [...CARTA_IMAGEN_ALLOWED_MIME_TYPES],
});

/**
 * multipart/form-data con un solo archivo en el campo `imagen` (JPEG, PNG o
 * WebP, máximo 10 MB) a un temporal. Los rechazos del parser (tipo, tamaño,
 * más de un archivo, cuerpo dañado) salen como 400 CARD_IMAGE_INVALID.
 */
export const parseCartaImagenMultipart = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  parseImagen(req, res, (error?: unknown) => {
    if (error instanceof ApiError && error.statusCode === 400) {
      res.status(400).json({
        success: false,
        code: "CARD_IMAGE_INVALID",
        message: error.message,
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

function uploadedFiles(req: Request): Express.Multer.File[] {
  if (Array.isArray(req.files)) return req.files;
  return req.file ? [req.file] : [];
}

/**
 * POST /api/beneficios/minijuego/carta-imagen (staff)
 *
 * Normaliza la imagen y la sube a minijuegos/cartas/<uuid>.webp. No depende
 * de un minijuego: el panel sube al guardar y luego manda la URL en
 * cartaImagenUrl del premio especial.
 */
export const uploadCartaImagen = async (req: Request, res: Response) => {
  const files = uploadedFiles(req);
  try {
    const file = files[0];
    if (!file?.path) {
      return res.status(400).json({
        success: false,
        code: "CARD_IMAGE_INVALID",
        message: "Selecciona una imagen JPEG, PNG o WebP para la carta.",
      });
    }

    const data = await subirCartaImagen({
      source: file.path,
      uploadedBy: req.user?.uid ?? "",
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    if (error instanceof CartaImagenError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    console.error("Error en POST /api/beneficios/minijuego/carta-imagen:", error);
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "No pudimos subir la imagen de la carta. Intenta de nuevo.",
    });
  } finally {
    // parseMultipartImages solo limpia sus temporales cuando falla.
    await Promise.allSettled(
      files
        .filter((file) => typeof file.path === "string" && file.path)
        .map((file) => fs.unlink(file.path)),
    );
  }
};
