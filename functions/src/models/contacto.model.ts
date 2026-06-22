import { Timestamp } from "firebase-admin/firestore";

/**
 * Estados posibles de un contacto
 */
export enum EstadoContacto {
    PENDIENTE = "PENDIENTE",
    ATENDIDO = "ATENDIDO",
    CERRADO = "CERRADO"
}

/**
 * Modelo de contacto almacenado en Firestore
 */
export interface Contacto {
    id?: string;
    uid?: string;
    nombre: string;
    email: string;
    telefono?: string;
    asunto: string;
    mensaje: string;
    estatus: EstadoContacto;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * DTO para crear un nuevo contacto (entrada del usuario)
 */
export interface CrearContactoDTO {
    nombre: string;
    email: string;
    telefono?: string;
    asunto: string;
    mensaje: string;
}

/**
 * DTO para actualizar el estado de un contacto (uso interno/admin)
 */
export interface ActualizarContactoDTO {
    estatus: EstadoContacto;
}
