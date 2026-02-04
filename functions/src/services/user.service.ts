/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { CrearUsuarioAppDTO, UsuarioApp } from '../models/usuario.model';

/**
 * Colección de usuarios en Firestore
 */
const USUARIOSAPP_COLLECTION = "usuariosApp";

/**
 * Clase UserAppService
 * Encapsula las operaciones CRUD y consultas de productos
 */
export class UserAppService {
    /**
     * Obtiene todos los productos activos
     * @returns Promise con array de usuarios activos ordenados alfabéticamente
     */
    async getAllUsers(): Promise<UsuarioApp[]> {
        try {
            // Consultar colección de productos (sin orderBy para evitar índice compuesto)
            const snapshot = await firestoreApp
                .collection(USUARIOSAPP_COLLECTION)
                .where("activo", "==", true) // Filtrar solo productos activos
                .get();

            // Si no hay usuarios, retornar array vacío
            if (snapshot.empty) {
                console.log("No se encontraron usuarios activos");
                return [];
            }

            // Mapear documentos a objetos Producto
            const usuarios: UsuarioApp[] = snapshot.docs.map((doc) => {
                const data = doc.data();

                return {
                    id: doc.id,
                    uid: data.uid,
                    provider: data.provider,
                    nombre: data.nombre,
                    email: data.email,
                    telefono: data.telefono,
                    puntosActuales: data.puntosActuales,
                    nivel: data.nivel,
                    fechaNacimiento: data.fechaNacimiento,
                    perfilCompleto: data.perfilCompleto,
                    activo: data.activo,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                } as UsuarioApp;
            });

            // Ordenar alfabéticamente en memoria
            usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre));

            console.log(`Se obtuvieron ${usuarios.length} usuarios activos`);
            return usuarios;
        } catch (error) {
            console.error("Error al obtener usuarios:", error);
            throw new Error("Error al obtener usuarios de la base de datos");
        }
    }
    async updateByUid(uid: string, data: any) {

        const snapshot = await firestoreApp
            .collection(USUARIOSAPP_COLLECTION)
            .where("uid", "==", uid)
            .limit(1)
            .get();

        if (snapshot.empty) {
            throw new Error("Usuario no encontrado");
        }

        const doc = snapshot.docs[0];

        await doc.ref.update({
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const updated = await doc.ref.get();

        return {
            id: updated.id,
            ...updated.data()
        };
    }


    /**
     * Obtiene un producto por su ID
     * @param id - ID del documento en Firestore
     * @returns Promise con el usuario o null si no existe
     */
    async getUserById(id: string): Promise<UsuarioApp | null> {
        try {
            const doc = await firestoreApp
                .collection(USUARIOSAPP_COLLECTION)
                .doc(id)
                .get();

            if (!doc.exists) {
                console.log(`Usuario con ID ${id} no encontrado`);
                return null;
            }

            const data = doc.data()!;
            return {
                id: doc.id,
                uid: data.uid,
                provider: data.provider,
                nombre: data.nombre,
                email: data.email,
                telefono: data.telefono,
                puntosActuales: data.puntosActuales,
                nivel: data.nivel,
                fechaNacimiento: data.fechaNacimiento,
                perfilCompleto: data.perfilCompleto,
                activo: data.activo,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            } as UsuarioApp;
        } catch (error) {
            console.error(`❌ Error al obtener usuario ${id}:`, error);
            throw new Error("Error al obtener el usuario");
        }
    }

    async existsByEmail(email: string): Promise<boolean> {
        const snapshot = await firestoreApp
            .collection(USUARIOSAPP_COLLECTION)
            .where("email", "==", email)
            .limit(1)
            .get();

        return !snapshot.empty;
    }


    /**
     * Obtiene productos por categoría
     * @param categoriaId - ID de la categoría
     * @returns Promise con array de productos de la categoría
     
    async getProductsByCategory(categoriaId: string): Promise<UsuarioApp[]> {
        try {
            const snapshot = await firestore
                .collection(USUARIOSAPP_COLLECTION)
                .where("categoriaId", "==", categoriaId)
                .where("activo", "==", true)
                .get();

            const productos: UsuarioApp[] = snapshot.docs.map(
                (doc) =>
                ({
                    id: doc.id,
                    ...doc.data(),
                } as UsuarioApp)
            );

            // Ordenar alfabéticamente en memoria
            productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

            return productos;
        } catch (error) {
            console.error("❌ Error al obtener productos por categoría:", error);
            throw new Error("Error al obtener productos por categoría");
        }
    }
        */

    /**
     * Obtiene productos por línea
     * @param lineaId - ID de la línea
     * @returns Promise con array de productos de la línea
     
    async getProductsByLine(lineaId: string): Promise<UsuarioApp[]> {
        try {
            const snapshot = await firestore
                .collection(USUARIOSAPP_COLLECTION)
                .where("lineaId", "==", lineaId)
                .where("activo", "==", true)
                .get();

            const productos: Producto[] = snapshot.docs.map(
                (doc) =>
                ({
                    id: doc.id,
                    ...doc.data(),
                } as Producto)
            );

            // Ordenar alfabéticamente en memoria
            productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

            return productos;
        } catch (error) {
            console.error("Error al obtener productos por línea:", error);
            throw new Error("Error al obtener productos por línea");
        }
    }

    */

    /**
     * Busca productos por texto en descripción o clave
     * @param searchTerm - Término de búsqueda
     * @returns Promise con array de productos que coinciden
     */
    async searchUsers(searchTerm: string): Promise<UsuarioApp[]> {
        try {
            // Nota: Firestore no tiene búsqueda full-text nativa
            // Esta es una implementación básica que busca por inicio de descripción
            // Para búsqueda más avanzada, considerar usar Algolia o similar

            const searchTermLower = searchTerm.toLowerCase();

            const snapshot = await firestoreApp
                .collection(USUARIOSAPP_COLLECTION)
                .where("activo", "==", true)
                .get();

            const usuarios: UsuarioApp[] = snapshot.docs
                .map(
                    (doc) =>
                    ({
                        id: doc.id,
                        ...doc.data(),
                    } as UsuarioApp)
                )
                .filter(
                    (usuario) =>
                        usuario.nombre.toLowerCase().includes(searchTermLower) ||
                        usuario.uid.toLowerCase().includes(searchTermLower)
                );

            return usuarios;
        } catch (error) {
            console.error("❌ Error al buscar usuarios:", error);
            throw new Error("Error al buscar usuarios");
        }
    }

    /**
     * Crea un nuevo usuario
     * @param usuarioData - Datos del usuario a crear
     * @returns Promise con el usuario creado incluyendo su ID
     */
    async createUser(
        usuarioData: CrearUsuarioAppDTO
    ): Promise<UsuarioApp> {


        try {
            const now = admin.firestore.Timestamp.now();

            const nuevoUsuarioData: Omit<UsuarioApp, "id"> = {
                uid: usuarioData.uid, // UID interno
                provider: "email",
                nombre: usuarioData.nombre,
                email: usuarioData.email.toLowerCase(),
                telefono: usuarioData.telefono,
                fechaNacimiento: usuarioData.fechaNacimiento,
                puntosActuales: 0,
                nivel: "Bronce",
                perfilCompleto: true,
                activo: true,
                createdAt: now,
                updatedAt: now,
            };

            // VALIDAR EMAIL
            const emailExists = await this.existsByEmail(usuarioData.email);
            if (emailExists) {
                throw new Error("El correo electrónico ya está registrado");
            }



            // Crear el documento con timestamps
            const docRef = await firestoreApp
                .collection(USUARIOSAPP_COLLECTION)
                .add(nuevoUsuarioData);


            // Obtener el documento creado
            const docSnapshot = await docRef.get();
            const data = docSnapshot.data()!;

            const nuevoUsuario: UsuarioApp = {
                id: docRef.id,
                ...data,
            } as UsuarioApp;

            console.log(
                `Usuario creado: ${nuevoUsuario.nombre} (ID: ${nuevoUsuario.id})`
            );
            return nuevoUsuario;
        } catch (error) {
            console.error("❌ Error al crear usuario:", error);
            throw new Error(
                error instanceof Error ? error.message : "Error al crear el usuario"
            );
        }
    }

    /**
     * Actualiza un usuario existente
     * @param id - ID del usuario a actualizar
     * @param updateData - Datos a actualizar
     * @returns Promise con el usuario actualizado
     */
    async updateUser(
        id: string,
        updateData: Partial<Omit<UsuarioApp, "id" | "createdAt" | "updatedAt">>
    ): Promise<UsuarioApp> {
        try {
            const docRef = firestoreApp.collection(USUARIOSAPP_COLLECTION).doc(id);
            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Usuario con ID ${id} no encontrado`);
            }

            // Si se intenta actualizar la clave, validar que no exista
            if (updateData.uid) {
                const existingUser = await firestoreApp
                    .collection(USUARIOSAPP_COLLECTION)
                    .where("clave", "==", updateData.uid)
                    .limit(1)
                    .get();

                if (!existingUser.empty && existingUser.docs[0].id !== id) {
                    throw new Error(
                        `Ya existe otro usuario con la clave: ${updateData.uid}`
                    );
                }
            }

            // Actualizar con timestamp
            const now = admin.firestore.Timestamp.now();
            await docRef.update({
                ...updateData,
                updatedAt: now,
            });

            // Obtener el documento actualizado
            const updatedDoc = await docRef.get();
            const updatedProducto: UsuarioApp = {
                id: updatedDoc.id,
                ...updatedDoc.data(),
            } as UsuarioApp;

            console.log(`Usuario actualizado: ${updatedProducto.nombre}`);
            return updatedProducto;
        } catch (error) {
            console.error("Error al actualizar usuario:", error);
            throw new Error(
                error instanceof Error
                    ? error.message
                    : "Error al actualizar el usuario"
            );
        }
    }

    /**
     * Elimina un usuario (soft delete - marca como inactivo)
     * @param id - ID del producto a usuario
     * @returns Promise<void>
     */
    async deleteUser(id: string): Promise<void> {
        try {
            const docRef = firestoreApp.collection(USUARIOSAPP_COLLECTION).doc(id);
            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Usuario con ID ${id} no encontrado`);
            }

            // Soft delete: marcar como inactivo
            const now = admin.firestore.Timestamp.now();
            await docRef.update({
                activo: false,
                updatedAt: now,
            });

            console.log(`Usuario eliminado (inactivo): ID ${id}`);
        } catch (error) {
            console.error("Error al eliminar usuario:", error);
            throw new Error(
                error instanceof Error ? error.message : "Error al eliminar el usuario"
            );
        }
    }
}

// Exportar instancia única del servicio (Singleton)
export default new UserAppService();
