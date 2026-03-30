import { Request, Response } from "express";
import pointsService from "../../services/puntos.service";

export const assignPoints = async (req: Request, res: Response) => {
	try {
		const { id } = req.params;
		const { points } = req.body as { points: number };

		const usuario = await pointsService.addPoints(id, points, {
			origen: "admin",
			descripcion: "Asignacion manual de puntos",
		});

		return res.status(200).json({
			success: true,
			message: "Puntos asignados exitosamente",
			data: {
				id: usuario.id ?? id,
				puntosAsignados: points,
				puntosActuales: usuario.puntosActuales,
			},
		});
	} catch (error) {
		console.error("Error al asignar puntos al usuario:", error);

		const message = error instanceof Error ? error.message : "Error desconocido";
		const statusCode = message.includes("no encontrado") ? 404 : 500;

		return res.status(statusCode).json({
			success: false,
			message: "Error al asignar puntos",
			error: message,
		});
	}
};
