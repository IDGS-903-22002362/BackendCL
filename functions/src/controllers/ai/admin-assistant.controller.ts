import { Request, Response } from "express";
import aiConfig from "../../config/ai.config";
import { RolUsuario } from "../../models/usuario.model";
import adminAssistantService from "../../services/ai/analytics/admin-report.service";
import { toAiErrorPayload } from "../../services/ai/ai.error";
import logger from "../../utils/logger";

const streamLogger = logger.child({ component: "admin-assistant-controller" });

const wantsSseResponse = (req: Request): boolean =>
  aiConfig.api.enableSse &&
  (req.body?.stream === true ||
    req.query.stream === "true" ||
    (req.headers.accept || "").includes("text/event-stream"));

const sendError = (res: Response, error: unknown) => {
  const payload = toAiErrorPayload(error);
  return res.status(payload.statusCode).json({
    success: false,
    error: { code: payload.code, message: payload.message },
  });
};

export const createSession = async (req: Request, res: Response) => {
  const session = await adminAssistantService.createSession({
    userId: req.user!.uid,
    title: req.body?.title,
  });

  return res.status(201).json({ success: true, data: session });
};

export const listSessions = async (req: Request, res: Response) => {
  const sessions = await adminAssistantService.listSessions(req.user!.uid);
  return res
    .status(200)
    .json({ success: true, count: sessions.length, data: sessions });
};

export const getSessionDetail = async (req: Request, res: Response) => {
  const session = await adminAssistantService.getOwnedSession(
    req.params.id,
    req.user!.uid,
  );

  if (!session) {
    return res
      .status(404)
      .json({ success: false, message: "Sesion no encontrada" });
  }

  const turns = await adminAssistantService.listTurns(session.id);
  return res.status(200).json({ success: true, data: { session, turns } });
};

export const ask = async (req: Request, res: Response) => {
  const session = await adminAssistantService.getOwnedSession(
    req.body.sessionId,
    req.user!.uid,
  );

  if (!session) {
    return res
      .status(404)
      .json({ success: false, message: "Sesion no encontrada" });
  }

  const payload = {
    sessionId: session.id,
    userId: req.user!.uid,
    role: req.user!.rol as RolUsuario,
    question: req.body.question as string,
    requestId: req.requestId,
  };

  if (wantsSseResponse(req)) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    try {
      for await (const event of adminAssistantService.askStream(payload)) {
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
      res.write("event: done\ndata: {}\n\n");
    } catch (error) {
      const errorPayload = toAiErrorPayload(error);

      // El error viaja por SSE con status 200: sin este log el fallo es invisible.
      streamLogger.error("admin_assistant_stream_failed", {
        sessionId: session.id,
        userId: payload.userId,
        requestId: payload.requestId,
        code: errorPayload.code,
        errorMessage:
          error instanceof Error ? error.message : "Error desconocido",
      });

      res.write(
        `event: error\ndata: ${JSON.stringify({
          code: errorPayload.code,
          message: errorPayload.message,
        })}\n\n`,
      );
      res.write("event: done\ndata: {}\n\n");
    }

    res.end();
    return;
  }

  try {
    const result = await adminAssistantService.ask(payload);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
};
