import { Request, Response } from "express";
import pointsService from "../../services/puntos.service";
import { RolUsuario } from "../../models/usuario.model";
import userAppService from "../../services/user.service";
import { firestoreApp } from "../../config/app.firebase";

export const assignPoints = async (req: Request, res: Response) => {
	try {
		const { id } = req.params;
		const { points, descripcion } = req.body as {
			points: number;
			descripcion?: string;
		};

		const descripcionMovimiento = descripcion?.trim() || "Asignación manual de puntos";
		const origenMovimientoId = (req as any).user?.uid ?? "admin-api";

		const usuario = await pointsService.addPoints(id, points, {
			origen: "admin",
			origenId: origenMovimientoId,
			descripcion: descripcionMovimiento,
		});

		return res.status(200).json({
			success: true,
			message: "Puntos asignados exitosamente",
			data: {
				id: usuario.id ?? id,
				puntosAsignados: points,
				puntosActuales: usuario.puntosActuales,
				descripcion: descripcionMovimiento,
				origenId: origenMovimientoId,
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

export const assignPointsBySale = async (req: Request, res: Response) => {
	try {
		const { id } = req.params;
		const { dinero, descripcion } = req.body as {
			dinero: number;
			descripcion?: string;
		};

		// Convertir dinero a puntos: multiplicar por 0.10 y redondear
		const points = Math.round(dinero * 0.10);

		const descripcionMovimiento =
			descripcion?.trim() || `Puntos por venta de $${dinero}`;

		const origenMovimientoId = (req as any).user?.uid ?? "admin-api";

		const usuario = await pointsService.addPoints(id, points, {
			origen: "admin",
			origenId: origenMovimientoId,
			descripcion: descripcionMovimiento,
			referencia: `venta_${dinero}`,
		});

		return res.status(200).json({
			success: true,
			message: "Puntos asignados exitosamente por monto de venta",
			data: {
				id: usuario.id ?? id,
				montoVenta: dinero,
				puntosAsignados: points,
				puntosActuales: usuario.puntosActuales,
				descripcion: descripcionMovimiento,
				origenId: origenMovimientoId,
			},
		});
	} catch (error) {
		console.error("Error al asignar puntos por venta:", error);
		const message = error instanceof Error ? error.message : "Error desconocido";
		const statusCode = message.includes("no encontrado") ? 404 : 500;
		return res.status(statusCode).json({
			success: false,
			message: "Error al asignar puntos por venta",
			error: message,
		});
	}
};

export const getHistorialAsignaciones = async (req: Request, res: Response) => {
	try {
		const currentUser = (req as any).user;
		const { usuarioId, limit, cursor, empleadoId } = req.query;

		const esAdmin = currentUser.rol === RolUsuario.ADMIN;
		const esEmpleado = currentUser.rol === RolUsuario.EMPLEADO;

		if (!esAdmin && !esEmpleado) {
			return res.status(403).json({
				success: false,
				message: "No tienes permisos para ver este historial",
			});
		}

		// 🔐 Empleados: solo ven sus propias asignaciones
		// Admin: puede ver sus asignaciones o las de un empleado específico
		let origenIdParaConsulta: string;
		if (esEmpleado) {
			origenIdParaConsulta = currentUser.uid;
		} else if (esAdmin && empleadoId) {
			// Admin puede ver las asignaciones de un empleado específico
			origenIdParaConsulta = empleadoId as string;
		} else if (esAdmin) {
			// Si es admin y no especifica empleadoId, ver sus propias asignaciones
			origenIdParaConsulta = currentUser.uid;
		} else {
			return res.status(403).json({
				success: false,
				message: "Parámetros inválidos",
			});
		}

		// Paginación: el cursor es el path del último documento
		let startAfterDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined = undefined;
		if (cursor && typeof cursor === 'string') {
			const docRef = firestoreApp.doc(cursor);
			const docSnap = await docRef.get();
			if (docSnap.exists) {
				startAfterDoc = docSnap as FirebaseFirestore.QueryDocumentSnapshot;
			}
		}

		const result = await pointsService.getAsignacionesHechas(
			origenIdParaConsulta,
			{
				usuarioId: usuarioId as string | undefined,
				limit: limit ? parseInt(limit as string) : 50,
				startAfterDoc,
			}
		);

		// Enriquecer con nombres de usuario (opcional pero recomendado)
		const movimientosEnriquecidos = await Promise.all(
			result.movimientos.map(async (mov) => {
				const usuario = await userAppService.getUserById(mov.usuarioId);
				return {
					...mov,
					usuarioNombre: usuario?.nombre || usuario?.email || "Usuario",
					usuarioEmail: usuario?.email || "",
				};
			})
		);

		return res.status(200).json({
			success: true,
			data: movimientosEnriquecidos,
			pagination: {
				nextCursor: result.nextCursor,
				hasMore: !!result.nextCursor,
			},
		});
	} catch (error) {
		console.error("Error en getHistorialAsignaciones:", error);
		return res.status(500).json({
			success: false,
			message: "Error al obtener el historial de asignaciones",
		});
	}
};
