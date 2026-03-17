import { Request, Response } from "express";
import aiFileService from "../../services/ai/ai-file.service";

export const uploadUserImage = async (req: Request, res: Response) => {
  try {
    const file = (req.file || (Array.isArray(req.files) ? req.files[0] : undefined)) as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "Se requiere una imagen para try-on" });
    }

    const asset = await aiFileService.uploadUserImage({
      userId: req.user!.uid,
      sessionId: typeof req.body.sessionId === "string" ? req.body.sessionId : undefined,
      file,
    });

    return res.status(201).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "No se pudo subir la imagen para try-on",
    });
  }
};
