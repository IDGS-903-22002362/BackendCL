import { Request, Response } from "express";
import ligaMxService, { DivisionKey } from "../../services/liga-mx";

const getDivisionKey = (req: Request): DivisionKey => req.query.division as DivisionKey;

export const getContext = async (_req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getContext();

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el contexto de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getCalendar = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getCalendar(getDivisionKey(req));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el calendario de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getStandings = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getStandings(getDivisionKey(req));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener la clasificación de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getRoster = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getRoster(getDivisionKey(req));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener la plantilla de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getPlayer = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getPlayer(req.params.idAfiliado);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `No se encontró el jugador ${req.params.idAfiliado}`,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el jugador de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getMatch = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getMatch(req.params.idPartido);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `No se encontró el partido ${req.params.idPartido}`,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el partido de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getMatchDetail = async (req: Request, res: Response) => {
  try {
    const data = await ligaMxService.getMatchDetail(req.params.idPartido);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `No se encontró el detalle del partido ${req.params.idPartido}`,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el detalle del partido de Liga MX",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};