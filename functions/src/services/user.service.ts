/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { authAppOficial, firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import pointsService from "./puntos.service";
import { syncFirebaseAdminClaims } from "../utils/middlewares";
import {
  CrearUsuarioAppDTO,
  RolUsuario,
  UsuarioApp,
} from "../models/usuario.model";

/**
 * Colección de usuarios en Firestore
 */
const USUARIOSAPP_COLLECTION = "usuariosApp";

const normalizeUserRoles = (
  data: FirebaseFirestore.DocumentData,
): string[] => {
  if (Array.isArray(data.roles)) {
    return data.roles.filter((role): role is string => typeof role === "string");
  }

  if (typeof data.rol === "string" && data.rol.trim().length > 0) {
    return [data.rol];
  }

  return [RolUsuario.CLIENTE];
};

function toTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string" || value instanceof Date) {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const parsed = (value as { toDate: () => Date }).toDate().getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function dedupeUsuariosByUid(usuarios: UsuarioApp[]): UsuarioApp[] {
  const byUid = new Map<string, UsuarioApp>();

  for (const usuario of usuarios) {
    const uid = usuario.uid?.trim();
    if (!uid) continue;

    const existing = byUid.get(uid);
    if (!existing) {
      byUid.set(uid, usuario);
      continue;
    }

    const usuarioIsCanonical = usuario.id === uid;
    const existingIsCanonical = existing.id === uid;
    if (usuarioIsCanonical && !existingIsCanonical) {
      byUid.set(uid, usuario);
      continue;
    }
    if (!usuarioIsCanonical && existingIsCanonical) {
      continue;
    }

    const usuarioUpdated = toTimestampMs(usuario.updatedAt ?? usuario.createdAt);
    const existingUpdated = toTimestampMs(
      existing.updatedAt ?? existing.createdAt,
    );
    if (usuarioUpdated >= existingUpdated) {
      byUid.set(uid, usuario);
    }
  }

  return Array.from(byUid.values());
}

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
          roles: normalizeUserRoles(data),
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

      const uniqueUsuarios = dedupeUsuariosByUid(usuarios);

      // Ordenar alfabéticamente en memoria
      uniqueUsuarios.sort((a, b) => a.nombre.localeCompare(b.nombre));

      console.log(`Se obtuvieron ${uniqueUsuarios.length} usuarios activos`);
      return uniqueUsuarios;
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
        roles: normalizeUserRoles(data),
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
    const normalizedEmail = usuarioData.email.toLowerCase().trim();
    const rol = usuarioData.rol ?? RolUsuario.CLIENTE;

    const emailExists = await this.existsByEmail(normalizedEmail);
    if (emailExists) {
      throw new Error("El correo electrónico ya está registrado");
    }

    try {
      await authAppOficial.getUserByEmail(normalizedEmail);
      throw new Error("El correo electrónico ya está registrado");
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code || "")
          : "";

      if (code !== "auth/user-not-found") {
        if (code === "auth/email-already-exists") {
          throw new Error("El correo electrónico ya está registrado");
        }

        if (code) {
          console.warn("auth_email_lookup_failed", {
            code,
            email: normalizedEmail,
          });
        } else {
          throw error;
        }
      }
    }

    const authUser = await authAppOficial.createUser({
      email: normalizedEmail,
      password: usuarioData.password,
      displayName: usuarioData.nombre,
    });

    const now = admin.firestore.Timestamp.now();
    const nuevoUsuarioData: Omit<UsuarioApp, "id"> = {
      uid: authUser.uid,
      provider: "email",
      nombre: usuarioData.nombre,
      email: normalizedEmail,
      rol,
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

    const docRef = firestoreApp
      .collection(USUARIOSAPP_COLLECTION)
      .doc(authUser.uid);

    try {
      await docRef.create(nuevoUsuarioData);
      const usuario = await pointsService.otorgarBonoBienvenida(authUser.uid);

      try {
        await syncFirebaseAdminClaims(authUser.uid, rol);
      } catch (claimsError) {
        console.error("admin_claims_sync_error", {
          uid: authUser.uid,
          rol,
          reason:
            claimsError instanceof Error ? claimsError.message : "unknown",
        });
      }

      return usuario;
    } catch (createError) {
      try {
        await authAppOficial.deleteUser(authUser.uid);
      } catch (rollbackError) {
        console.error("rollback_auth_user_failed", {
          uid: authUser.uid,
          reason:
            rollbackError instanceof Error
              ? rollbackError.message
              : "unknown",
        });
      }

      console.error("Error al crear usuario:", createError);
      throw new Error(
        createError instanceof Error
          ? createError.message
          : "Error al crear el usuario",
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
