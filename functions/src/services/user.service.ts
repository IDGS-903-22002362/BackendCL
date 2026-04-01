/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import pointsService from "./puntos.service";
import {
  CrearUsuarioAppDTO,
  RolUsuario,
  UsuarioApp,
} from "../models/usuario.model";

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
        .collection(USUARIOSAPP_COLLECTION)// Filtrar solo productos activos
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
          rol: data.rol,
          telefono: data.telefono,
          puntosActuales: data.puntosActuales,
          nivel: data.nivel,
          fechaNacimiento: data.fechaNacimiento,
          perfilCompleto: data.perfilCompleto,
          edad: data.edad,
          genero: data.genero,
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const updated = await doc.ref.get();

    return {
      id: updated.id,
      ...updated.data(),
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
        rol: data.rol,
        telefono: data.telefono,
        puntosActuales: data.puntosActuales,
        nivel: data.nivel,
        fechaNacimiento: data.fechaNacimiento,
        perfilCompleto: data.perfilCompleto,
        edad: data.edad,
        genero: data.genero,
        activo: data.activo,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } as UsuarioApp;
    } catch (error) {
      console.error(`Error al obtener usuario ${id}:`, error);
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
            }) as UsuarioApp,
        )
        .filter(
          (usuario) =>
            usuario.nombre.toLowerCase().includes(searchTermLower) ||
            usuario.uid.toLowerCase().includes(searchTermLower),
        );

      return usuarios;
    } catch (error) {
      console.error("Error al buscar usuarios:", error);
      throw new Error("Error al buscar usuarios");
    }
  }

  /**
   * Crea un nuevo usuario
   * @param usuarioData - Datos del usuario a crear
   * @returns Promise con el usuario creado incluyendo su ID
   */
  async createUser(usuarioData: CrearUsuarioAppDTO): Promise<UsuarioApp> {
    try {
      // 1 CREAR EN FIREBASE AUTH primero
      const authUser = await admin.auth().createUser({
        email: usuarioData.email.toLowerCase(),
        password: usuarioData.password,
        displayName: usuarioData.nombre,
      });

      // 2 USAR el uid generado por Firebase (no uno random)
      const now = admin.firestore.Timestamp.now();

      const nuevoUsuarioData: Omit<UsuarioApp, "id"> = {
        uid: authUser.uid,  // ← UID auténtico de Firebase
        provider: "email",
        nombre: usuarioData.nombre,
        email: usuarioData.email.toLowerCase(),
        rol: usuarioData.rol ?? RolUsuario.CLIENTE,
        telefono: usuarioData.telefono,
        fechaNacimiento: usuarioData.fechaNacimiento,
        puntosActuales: 0,
        nivel: "Bronce",
        perfilCompleto: true,
        edad: usuarioData.edad,
        genero: usuarioData.genero,
        activo: true,
        createdAt: now,
        updatedAt: now,
      };

      const emailExists = await this.existsByEmail(usuarioData.email);
      if (emailExists) {
        throw new Error("El correo electrónico ya está registrado");
      }

      // 3 CREAR EN FIRESTORE con el uid auténtico
      const docRef = firestoreApp
        .collection(USUARIOSAPP_COLLECTION)
        .doc(authUser.uid);

      await docRef.create(nuevoUsuarioData);

      return pointsService.otorgarBonoBienvenida(authUser.uid);

    } catch (error) {
      console.error("Error al crear usuario:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear el usuario",
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
    updateData: Partial<Omit<UsuarioApp, "id" | "createdAt" | "updatedAt">>,
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
            `Ya existe otro usuario con la clave: ${updateData.uid}`,
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
          : "Error al actualizar el usuario",
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
        error instanceof Error ? error.message : "Error al eliminar el usuario",
      );
    }
  }

  async getUserByUid(uid: string): Promise<UsuarioApp | null> {
    const snapshot = await firestoreApp
      .collection(USUARIOSAPP_COLLECTION)
      .where("uid", "==", uid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as UsuarioApp;
  }

  async addPoints(uid: string, points: number): Promise<UsuarioApp> {
    return pointsService.addPoints(uid, points);
  }

  async reactivateUser(id: string): Promise<UsuarioApp> {
    try {
      const docRef = firestoreApp.collection(USUARIOSAPP_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Usuario con ID ${id} no encontrado`);
      }

      const userData = doc.data() as UsuarioApp;
      if (userData.activo) {
        return { id: doc.id, ...userData } as UsuarioApp; // ya está activo
      }

      const now = admin.firestore.Timestamp.now();
      await docRef.update({
        activo: true,
        updatedAt: now,
      });

      const updatedDoc = await docRef.get();
      return { id: updatedDoc.id, ...updatedDoc.data() } as UsuarioApp;
    } catch (error) {
      console.error('Error al reactivar usuario:', error);
      throw new Error(error instanceof Error ? error.message : 'Error al reactivar el usuario');
    }
  }
}

// Exportar instancia única del servicio (Singleton)
export default new UserAppService();
