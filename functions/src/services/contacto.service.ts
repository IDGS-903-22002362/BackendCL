import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
    Contacto,
    CrearContactoDTO,
    EstadoContacto,
    ActualizarContactoDTO
} from "../models/contacto.model";
import { ApiError } from "../lib/api/client";

const CONTACTOS_COLLECTION = "contactos";

class ContactoService {
    /**
     * Crea un nuevo contacto
     * @param data - Datos del contacto
     * @param uid - UID del usuario autenticado (opcional)
     * @returns Contacto creado con ID
     */
    async create(
        data: CrearContactoDTO,
        uid?: string
    ): Promise<Contacto> {
        // Validaciones de negocio
        if (!data.nombre?.trim()) {
            throw new ApiError(400, "El nombre es obligatorio");
        }
        if (!data.email?.trim()) {
            throw new ApiError(400, "El email es obligatorio");
        }
        if (!data.asunto?.trim()) {
            throw new ApiError(400, "El asunto es obligatorio");
        }
        if (!data.mensaje?.trim()) {
            throw new ApiError(400, "El mensaje es obligatorio");
        }
        // Validación básica de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
            throw new ApiError(400, "El formato del email no es válido");
        }

        const now = admin.firestore.Timestamp.now();

        const contacto: Omit<Contacto, "id"> = {
            uid,
            nombre: data.nombre.trim(),
            email: data.email.trim().toLowerCase(),
            telefono: data.telefono?.trim(),
            asunto: data.asunto.trim(),
            mensaje: data.mensaje.trim(),
            estatus: EstadoContacto.PENDIENTE,
            createdAt: now,
            updatedAt: now
        };

        const docRef = await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .add(contacto);

        return {
            id: docRef.id,
            ...contacto
        };
    }

    /**
     * Obtiene todos los contactos ordenados por fecha descendente
     * @returns Array de contactos
     */
    async getAll(): Promise<Contacto[]> {
        const snapshot = await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .orderBy("createdAt", "desc")
            .get();



        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Contacto[];
    }

    /**
     * Obtiene un contacto por ID
     * @param id - ID del documento
     * @returns Contacto o null si no existe
     */
    async getById(id: string): Promise<Contacto | null> {
        const doc = await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .doc(id)
            .get();

        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() } as Contacto;
    }

    /**
     * Actualiza el estado de un contacto
     * @param id - ID del contacto
     * @param estatus - Nuevo estado
     */
    async updateStatus(
        id: string,
        estatus: EstadoContacto
    ): Promise<void> {
        const contacto = await this.getById(id);
        if (!contacto) {
            throw new ApiError(404, "Contacto no encontrado");
        }

        await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .doc(id)
            .update({
                estatus,
                updatedAt: admin.firestore.Timestamp.now()
            });
    }

    /**
     * Actualiza un contacto parcialmente
     * @param id - ID del contacto
     * @param data - Datos a actualizar
     */
    async update(id: string, data: Partial<ActualizarContactoDTO>): Promise<void> {
        const contacto = await this.getById(id);
        if (!contacto) {
            throw new ApiError(404, "Contacto no encontrado");
        }

        await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .doc(id)
            .update({
                ...data,
                updatedAt: admin.firestore.Timestamp.now()
            });
    }

    /**
     * Elimina un contacto
     * @param id - ID del contacto
     */
    async delete(id: string): Promise<void> {
        const contacto = await this.getById(id);
        if (!contacto) {
            throw new ApiError(404, "Contacto no encontrado");
        }

        await firestoreApp
            .collection(CONTACTOS_COLLECTION)
            .doc(id)
            .delete();
    }
}

export default new ContactoService();