import { Request, Response } from "express";
import aiChatService from "../../services/ai/ai-chat.service";
import { RolUsuario } from "../../models/usuario.model";
import { toAiErrorPayload } from "../../services/ai/ai.error";

export const createSession = async (req: Request, res: Response) => {
  const session = await aiChatService.createSession({
    userId: req.user!.uid,
    role: req.user!.rol as RolUsuario,
    channel: req.body.channel,
    title: req.body.title,
  });

  return res.status(201).json({
    success: true,
    data: session,
  });
};

export const listSessions = async (req: Request, res: Response) => {
  const sessions = await aiChatService.listSessions(req.user!.uid);
  return res.status(200).json({
    success: true,
    count: sessions.length,
    data: sessions,
  });
};

export const getSessionDetail = async (req: Request, res: Response) => {
  const detail = await aiChatService.getSessionDetail(req.params.id);
  if (!detail.session) {
    return res.status(404).json({ success: false, message: "Sesion AI no encontrada" });
  }

  if (detail.session.userId !== req.user!.uid && req.user!.rol !== RolUsuario.ADMIN) {
    return res.status(403).json({ success: false, message: "No tienes permisos para esta sesion AI" });
  }

  return res.status(200).json({
    success: true,
    data: detail,
  });
};

export const sendMessage = async (req: Request, res: Response) => {
  const wantsSse = req.body.stream === true || req.query.stream === "true" || (req.headers.accept || "").includes("text/event-stream");
  const payload = {
    sessionId: req.body.sessionId,
    userId: req.user!.uid,
    role: req.user!.rol as RolUsuario,
    message: req.body.message,
    aiToolScopes: Array.isArray(req.user!.aiToolScopes) ? req.user!.aiToolScopes.map((scope) => String(scope)) : [],
    requestId: req.requestId,
  };

  if (wantsSse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    try {
      res.write(`event: status\ndata: ${JSON.stringify({ status: "processing" })}\n\n`);
      const result = await aiChatService.sendMessage(payload);
      res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      res.write(`event: final\ndata: ${JSON.stringify(result)}\n\n`);
      res.write("event: done\ndata: {}\n\n");
      res.end();
    } catch (error) {
      const errorPayload = toAiErrorPayload(error);
      res.write(`event: error\ndata: ${JSON.stringify({
        code: errorPayload.code,
        message: errorPayload.message,
      })}\n\n`);
      res.write("event: done\ndata: {}\n\n");
      res.end();
    }
    return;
  }

  try {
    const result = await aiChatService.sendMessage(payload);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorPayload = toAiErrorPayload(error);
    return res.status(errorPayload.statusCode).json({
      success: false,
      error: {
        code: errorPayload.code,
        message: errorPayload.message,
      },
    });
  }
};
