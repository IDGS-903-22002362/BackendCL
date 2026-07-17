import { Request, Response } from "express";
import { RolUsuario } from "../../models/usuario.model";
import aiConfig from "../../config/ai.config";
import { toAiErrorPayload } from "../../services/ai/ai.error";
import aiStorageService from "../../services/ai/storage/ai-storage.service";
import tryOnWorkflowService from "../../services/ai/jobs/tryon-workflow.service";
import tryOnJobService from "../../services/ai/jobs/tryon-job.service";
import logger from "../../utils/logger";

const tryOnControllerLogger = logger.child({ component: "tryon-controller" });

export const createTryOnJob = async (req: Request, res: Response) => {
  try {
    const job = await tryOnWorkflowService.createJob({
      userId: req.user!.uid,
      sessionId: req.body.sessionId,
      productId: req.body.productId,
      variantId: req.body.variantId,
      sku: req.body.sku,
      userImageAssetId: req.body.userImageAssetId,
      consentAccepted: req.body.consentAccepted,
      idempotencyKey: req.body.idempotencyKey,
      requestedByRole: req.user!.rol as RolUsuario,
    });

    return res.status(201).json({
      success: true,
      data: job,
    });
  } catch (error) {
    const errorPayload = toAiErrorPayload(error);
    return res.status(errorPayload.statusCode).json({
      success: false,
      message: errorPayload.message,
      error: {
        code: errorPayload.code,
        message: errorPayload.message,
      },
    });
  }
};

export const listTryOnJobs = async (req: Request, res: Response) => {
  const jobs = await tryOnJobService.listJobsByUser(req.user!.uid);
  return res.status(200).json({
    success: true,
    count: jobs.length,
    data: jobs,
  });
};

export const getTryOnJob = async (req: Request, res: Response) => {
  const job = await tryOnWorkflowService.getJobStatus(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  if (job.userId !== req.user!.uid && req.user!.rol !== RolUsuario.ADMIN) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  return res.status(200).json({ success: true, data: job });
};

export const getTryOnDownloadLink = async (req: Request, res: Response) => {
  const job = await tryOnWorkflowService.getJobStatus(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  if (job.userId !== req.user!.uid && req.user!.rol !== RolUsuario.ADMIN) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  let url: string | null;
  try {
    url = await tryOnWorkflowService.getDownloadUrl(req.params.id);
  } catch (error) {
    tryOnControllerLogger.error("tryon_download_link_failed", {
      jobId: req.params.id,
      userId: req.user?.uid,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return res.status(500).json({
      success: false,
      message: "No se pudo generar el link de descarga del try-on",
    });
  }

  if (!url) {
    return res.status(409).json({
      success: false,
      message: "El resultado del try-on aun no esta disponible",
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      jobId: req.params.id,
      url,
      expiresInSec: aiConfig.storage.signedUrlTtlSec,
    },
  });
};

export const streamTryOnImage = async (req: Request, res: Response) => {
  const job = await tryOnWorkflowService.getJobStatus(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  if (job.userId !== req.user!.uid && req.user!.rol !== RolUsuario.ADMIN) {
    return res.status(404).json({ success: false, message: "Job de try-on no encontrado" });
  }

  const asset = await tryOnWorkflowService.getDownloadAsset(req.params.id);
  if (!asset) {
    return res.status(409).json({
      success: false,
      message: "El resultado del try-on aun no esta disponible",
    });
  }

  try {
    const downloaded = await aiStorageService.downloadGcsFile(
      aiStorageService.buildGcsUri(asset.objectPath, asset.bucket),
    );

    res.setHeader("Content-Type", downloaded.mimeType || "image/png");
    res.setHeader("Cache-Control", "private, max-age=300, no-store");
    res.setHeader("Content-Length", String(downloaded.sizeBytes));
    return res.status(200).send(downloaded.buffer);
  } catch (error) {
    tryOnControllerLogger.error("tryon_image_stream_failed", {
      jobId: req.params.id,
      userId: req.user?.uid,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return res.status(500).json({
      success: false,
      message: "No se pudo cargar la imagen del try-on",
    });
  }
};
