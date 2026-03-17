import { Request, Response } from "express";
import aiChatService from "../../services/ai/ai-chat.service";
import { RolUsuario } from "../../models/usuario.model";
import { AiAttachment } from "../../models/ai/ai.model";
import { toAiErrorPayload } from "../../services/ai/ai.error";

const wantsSseResponse = (req: Request): boolean =>
  req.body.stream === true ||
  req.query.stream === "true" ||
  (req.headers.accept || "").includes("text/event-stream");

const toAttachments = (value: unknown): AiAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const record = item as Record<string, unknown>;
      if (typeof record.assetId !== "string") {
        return null;
      }

      return {
        assetId: record.assetId,
        mimeType:
          typeof record.mimeType === "string"
            ? record.mimeType
            : "application/octet-stream",
        kind:
          typeof record.kind === "string"
            ? (record.kind as AiAttachment["kind"])
            : "generic",
      } satisfies AiAttachment;
    })
    .filter((item): item is AiAttachment => item !== null);
};

const writeStreamEvents = async (
  res: Response,
  iterator: AsyncGenerator<{
    type: string;
    data: unknown;
  }>,
): Promise<void> => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  try {
    for await (const event of iterator) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (error) {
    const errorPayload = toAiErrorPayload(error);
    res.write(
      `event: error\ndata: ${JSON.stringify({
        code: errorPayload.code,
        message: errorPayload.message,
      })}\n\n`,
    );
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }
};

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

export const createPublicSession = async (req: Request, res: Response) => {
  const result = await aiChatService.createPublicSession({
    channel: req.body.channel,
    title: req.body.title,
    guestLabel: req.body.guestLabel,
  });

  return res.status(201).json({
    success: true,
    data: result,
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
    return res
      .status(404)
      .json({ success: false, message: "Sesion AI no encontrada" });
  }

  if (
    detail.session.mode !== "guest" &&
    detail.session.userId !== req.user!.uid &&
    req.user!.rol !== RolUsuario.ADMIN
  ) {
    return res
      .status(403)
      .json({
        success: false,
        message: "No tienes permisos para esta sesion AI",
      });
  }

  return res.status(200).json({
    success: true,
    data: detail,
  });
};

export const sendMessage = async (req: Request, res: Response) => {
  const payload = {
    sessionId: req.body.sessionId,
    userId: req.user!.uid,
    role: req.user!.rol as RolUsuario,
    message: req.body.message,
    attachments: toAttachments(req.body.attachments),
    clientContext:
      typeof req.body.clientContext === "object" && req.body.clientContext !== null
        ? req.body.clientContext
        : undefined,
    aiToolScopes: Array.isArray(req.user!.aiToolScopes)
      ? req.user!.aiToolScopes.map((scope) => String(scope))
      : [],
    requestId: req.requestId,
  };

  if (wantsSseResponse(req)) {
    try {
      await aiChatService.assertMessageExecutionReady(payload);
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

    await writeStreamEvents(res, aiChatService.sendMessageStream(payload));
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

export const sendPublicMessage = async (req: Request, res: Response) => {
  const payload = {
    sessionId: req.body.sessionId,
    publicAccessToken: req.body.publicAccessToken,
    message: req.body.message,
    attachments: toAttachments(req.body.attachments),
    clientContext:
      typeof req.body.clientContext === "object" && req.body.clientContext !== null
        ? req.body.clientContext
        : undefined,
    requestId: req.requestId,
  };

  if (wantsSseResponse(req)) {
    try {
      await aiChatService.assertPublicMessageExecutionReady(payload);
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

    await writeStreamEvents(res, aiChatService.sendPublicMessageStream(payload));
    return;
  }

  try {
    const result = await aiChatService.sendPublicMessage(payload);
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
