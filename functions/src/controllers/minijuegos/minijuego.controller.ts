import { Request, Response } from "express";
import { GuardarMinijuegoInput } from "../../models/minijuego.model";
import minijuegoService from "../../services/minijuego.service";
import { MinijuegoError } from "../../services/minijuego.logic";

function actorFromRequest(req: Request) {
  return {
    uid: req.user!.uid,
    email: typeof req.user?.email === "string" ? req.user.email : undefined,
  };
}

function respondError(res: Response, error: unknown, label: string) {
  if (error instanceof MinijuegoError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error(label, error);
  return res.status(500).json({
    success: false,
    message: "Error al procesar el minijuego",
  });
}

export const createBeneficioMinijuego = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.createMinijuegoBeneficio(
      req.body as GuardarMinijuegoInput,
    );
    return res.status(201).json({
      success: true,
      message: "Minijuego creado exitosamente",
      data,
    });
  } catch (error) {
    return respondError(res, error, "Error en POST /api/beneficios/minijuego:");
  }
};

export const updateBeneficioMinijuego = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.updateMinijuegoBeneficio(
      req.params.id,
      req.body as GuardarMinijuegoInput,
    );
    return res.status(200).json({
      success: true,
      message: "Minijuego actualizado exitosamente",
      data,
    });
  } catch (error) {
    return respondError(
      res,
      error,
      "Error en PUT /api/beneficios/:id/minijuego:",
    );
  }
};

export const getDetails = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.getDetails(
      req.params.id,
      actorFromRequest(req),
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(res, error, "Error en GET /api/minijuegos/:id:");
  }
};

export const getPendingPlay = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.getPendingPlay(
      req.params.id,
      actorFromRequest(req),
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(
      res,
      error,
      "Error en GET /api/minijuegos/:id/pending-play:",
    );
  }
};

export const play = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.play(
      req.params.id,
      actorFromRequest(req),
      req.header("Idempotency-Key"),
    );
    return res.status(200).json({
      success: true,
      message: data.alreadyPlayed
        ? "Participación ya registrada"
        : "Participación registrada",
      data,
    });
  } catch (error) {
    return respondError(res, error, "Error en POST /api/minijuegos/:id/play:");
  }
};

export const getGanadoresEspecial = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.getGanadoresEspecial(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(
      res,
      error,
      "Error en GET /api/minijuegos/:id/ganadores-especial:",
    );
  }
};

export const listGanadoresEspecial = async (req: Request, res: Response) => {
  try {
    const minijuegoId =
      typeof req.query.minijuegoId === "string" && req.query.minijuegoId.trim()
        ? req.query.minijuegoId.trim()
        : undefined;
    const data = await minijuegoService.listGanadoresEspecial(minijuegoId);
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    return respondError(
      res,
      error,
      "Error en GET /api/beneficios/ganadores-especial:",
    );
  }
};

export const acknowledge = async (req: Request, res: Response) => {
  try {
    const data = await minijuegoService.acknowledge(
      req.params.id,
      req.params.playId,
      actorFromRequest(req),
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return respondError(
      res,
      error,
      "Error en POST /api/minijuegos/:id/plays/:playId/ack:",
    );
  }
};
