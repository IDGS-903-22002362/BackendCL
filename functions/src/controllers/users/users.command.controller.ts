import { Request, Response } from "express";
import userAppService from "../../services/user.service";
import pointsService from "../../services/puntos.service";
import { admin } from "../../config/firebase.admin";
import { getAppCheck } from "firebase-admin/app-check";

/**
 * Controller: Users Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
    try {
        const usuarioData = req.body;

        /**
        const camposRequeridos = [
            "clave",
            "descripcion",
            "lineaId",
            "categoriaId",
            "precioPublico",
            "precioCompra",
            "existencias",
            "proveedorId",
        ];

        const camposFaltantes = camposRequeridos.filter(
            (campo) => !usuarioData[campo] && usuarioData[campo] !== 0
        );

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Faltan campos requeridos",
                camposFaltantes,
            });
        }
             */

        usuarioData.activo =
            usuarioData.activo !== undefined ? usuarioData.activo : true;

        const nuevoUsuario = await userAppService.createUser(usuarioData);

        return res.status(201).json({
            success: true,
            message: "Usuario creado exitosamente",
            data: nuevoUsuario,
        });
    } catch (error) {
        console.error("Error en POST /api/usuarios:", error);
        return res.status(500).json({
            success: false,
            message: "Error al crear el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
export const checkEmail = async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const ensureMinDelay = async () => {
        const elapsed = Date.now() - startedAt;
        const minMs = 320;
        if (elapsed < minMs) {
            await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
        }
    };

    try {
        const rawEmail = req.query.email;
        const email =
            typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

        if (!email) {
            await ensureMinDelay();
            return res.status(400).json({
                success: false,
                message: "Email requerido",
            });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            await ensureMinDelay();
            return res.status(400).json({
                success: false,
                message: "Email invalido",
            });
        }

        const exists = await userAppService.existsByEmail(email);
        const appCheckToken = req.header("X-Firebase-AppCheck");
        let appCheckValid = false;

        if (appCheckToken) {
            try {
                await getAppCheck(admin.app()).verifyToken(appCheckToken);
                appCheckValid = true;
            } catch {
                appCheckValid = false;
            }
        }

        await ensureMinDelay();

        if (!appCheckValid) {
            return res.status(200).json({
                success: true,
                message:
                    "Verificacion completada. Continua con el registro si el correo es valido.",
            });
        }

        return res.status(200).json({
            success: true,
            exists,
        });
    } catch (error) {
        await ensureMinDelay();
        return res.status(500).json({
            success: false,
            message: "Error al verificar email",
        });
    }
};


export const update = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const usarioActualizado = await userAppService.updateUser(
            id,
            updateData
        );

        return res.status(200).json({
            success: true,
            message: "Usuario actualizado exitosamente",
            data: usarioActualizado,
        });
    } catch (error) {
        console.error("Error en PUT /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al actualizar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};


export const actualizarPerfil = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const { nombre, telefono } = req.body;

        const usuario = await userAppService.updateByUid(uid, {
            nombre,
            telefono
        });

        return res.status(200).json({
            success: true,
            data: usuario
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error actualizando perfil"
        });
    }
};



const calcularEdad = (fechaNacimiento?: string | Date): number | null => {
    if (!fechaNacimiento) return null;

    const nacimiento = new Date(fechaNacimiento);
    if (isNaN(nacimiento.getTime())) return null;

    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();

    const mes = hoy.getMonth() - nacimiento.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
        edad--;
    }

    return edad;
};

export const completarPerfil = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const { nombre, telefono, fechaNacimiento, genero } = req.body;

        const edad = calcularEdad(fechaNacimiento);

        const usuario = await userAppService.updateByUid(uid, {
            nombre,
            telefono,
            fechaNacimiento,
            genero,
            edad,
            perfilCompleto: true
        });

        return res.status(200).json({
            success: true,
            data: usuario
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error completando perfil"
        });
    }
};



export const remove = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await userAppService.deleteUser(id);
        return res.status(200).json({
            success: true,
            message: "Usuario eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error en DELETE /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al eliminar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const reactivate = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Opcional: verificar permisos (solo SUPER_ADMIN o ADMIN)
        // if (req.user.rol !== 'SUPER_ADMIN' && req.user.rol !== 'ADMIN') {
        //   return res.status(403).json({ success: false, message: 'No tienes permisos' });
        // }

        const usuarioReactivado = await userAppService.reactivateUser(id);
        return res.status(200).json({
            success: true,
            message: 'Usuario reactivado exitosamente',
            data: usuarioReactivado,
        });
    } catch (error) {
        const statusCode = error instanceof Error && error.message.includes('no encontrado') ? 404 : 500;
        return res.status(statusCode).json({
            success: false,
            message: 'Error al reactivar el usuario',
            error: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
};

export const sumarPuntos = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const puntosASumar = 5;
        const usuario = await pointsService.addPoints(uid, puntosASumar, {
            origen: "promo",
            descripcion: "Bonificación automática por interacción",
        });
        return res.status(200).json({
            success: true,
            puntos: usuario.puntosActuales,
        });
    } catch (error) {
        console.error("Error al sumar puntos:", error);
        return res.status(500).json({ success: false, message: "Error interno" });
    }
};


//Eliminación de cuenta por parte del usuario (solicitud de eliminación)
export const solicitarEliminacionCuenta = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;

        // Verificar si ya existe una solicitud pendiente
        const usuario = await userAppService.getUserByUid(uid);
        if (usuario?.solicitudEliminacion?.estado === "pendiente") {
            return res.status(400).json({
                success: false,
                message: "Ya tienes una solicitud de eliminación pendiente. Puedes cancelarla si cambias de opinión.",
            });
        }

        const now = admin.firestore.Timestamp.now();
        // 30 días en milisegundos
        const fechaProgramada = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        );

        const solicitud = {
            fechaSolicitud: now,
            fechaProgramada,
            estado: "pendiente" as const,
        };

        await userAppService.updateByUid(uid, {
            solicitudEliminacion: solicitud,
        });

        return res.status(200).json({
            success: true,
            message: "Solicitud de eliminación de cuenta registrada. Tu cuenta será eliminada permanentemente en 30 días. Puedes cancelar la solicitud en cualquier momento antes de esa fecha.",
            fechaProgramada: fechaProgramada.toDate().toISOString(),
        });
    } catch (error) {
        console.error("Error al solicitar eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al procesar la solicitud",
        });
    }
};

export const cancelarEliminacionCuenta = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const usuario = await userAppService.getUserByUid(uid);
        if (!usuario) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        if (!usuario.solicitudEliminacion || usuario.solicitudEliminacion.estado !== "pendiente") {
            return res.status(400).json({
                success: false,
                message: "No hay una solicitud de eliminación pendiente",
            });
        }

        // Eliminar el campo solicitudEliminacion (se puede borrar completamente o cambiar estado a cancelada)
        await userAppService.updateByUid(uid, {
            solicitudEliminacion: admin.firestore.FieldValue.delete(),
        });

        return res.status(200).json({
            success: true,
            message: "Solicitud de eliminación cancelada. Tu cuenta permanecerá activa sin cambios.",
        });
    } catch (error) {
        console.error("Error al cancelar eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al cancelar la solicitud",
        });
    }
};

export const obtenerEstadoEliminacion = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const usuario = await userAppService.getUserByUid(uid);
        if (!usuario) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        const solicitud = usuario.solicitudEliminacion;
        if (!solicitud || solicitud.estado !== "pendiente") {
            return res.status(200).json({
                success: true,
                tieneSolicitudPendiente: false,
            });
        }

        const ahora = Date.now();
        const fechaProgramadaMs = solicitud.fechaProgramada.toDate().getTime();
        const diasRestantes = Math.max(0, Math.ceil((fechaProgramadaMs - ahora) / (1000 * 60 * 60 * 24)));

        return res.status(200).json({
            success: true,
            tieneSolicitudPendiente: true,
            fechaSolicitud: solicitud.fechaSolicitud.toDate().toISOString(),
            fechaProgramada: solicitud.fechaProgramada.toDate().toISOString(),
            diasRestantes,
        });
    } catch (error) {
        console.error("Error al obtener estado de eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener el estado",
        });
    }
};