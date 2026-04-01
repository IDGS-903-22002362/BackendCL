import { Request, Response } from "express";
import paymentsService from "../../services/payments/payments.service";

const renderHtml = (
  title: string,
  body: string,
  nextPollAfterMs: number,
): string => {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 32px; max-width: 640px; margin: 0 auto;">
    <h1>${title}</h1>
    <p>${body}</p>
    <p>Polling sugerido: ${nextPollAfterMs} ms</p>
  </body>
</html>`;
};

const respondReturn = async (
  req: Request,
  res: Response,
  title: string,
) => {
  const state = await paymentsService.resolveBrowserReturnState(req.query);
  const payload = {
    ok: true,
    paymentAttemptId: state.paymentAttempt?.id,
    provider: state.paymentAttempt?.provider
      ? String(state.paymentAttempt.provider).toLowerCase()
      : "aplazo",
    status: state.paymentAttempt?.status,
    message: state.message,
    isTerminal: state.isTerminal,
    nextPollAfterMs: state.nextPollAfterMs,
  };

  if (req.accepts("json")) {
    return res.status(200).json(payload);
  }

  return res
    .status(200)
    .type("html")
    .send(renderHtml(title, state.message, state.nextPollAfterMs));
};

export const aplazoSuccessReturn = async (req: Request, res: Response) => {
  return respondReturn(req, res, "Estamos validando tu pago");
};

export const aplazoFailureReturn = async (req: Request, res: Response) => {
  return respondReturn(req, res, "No pudimos validar el pago todavía");
};

export const aplazoCancelReturn = async (req: Request, res: Response) => {
  return respondReturn(req, res, "El intento fue cancelado o sigue pendiente");
};
