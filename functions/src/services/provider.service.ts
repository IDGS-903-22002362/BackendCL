import * as admin from "firebase-admin";
import { firestoreTienda } from "../config/firebase";
import { Proveedor } from "../models/catalogo.model";

const PROVEEDORES_COLLECTION = "proveedores";

class ProviderService {
  /**
   * Obtiene todos los proveedores activos
   */
  async getAllProviders(): Promise<Proveedor[]> {
    try {
      const snapshot = await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .where("activo", "==", true)
        .get();

      if (snapshot.empty) {
        return [];
      }

      const proveedores: Proveedor[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Proveedor[];

      return proveedores;
    } catch (error) {
      console.error("Error en getAllProviders:", error);
      throw new Error("Error al obtener los proveedores de Firestore");
    }
  }

  /**
   * Obtiene un proveedor por ID
   */
  async getProviderById(id: string): Promise<Proveedor | null> {
    try {
      const doc = await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      if (!data || data.activo === false) {
        return null;
      }

      return {
        id: doc.id,
        ...data,
      } as Proveedor;
    } catch (error) {
      console.error(`Error en getProviderById(${id}):`, error);
      throw new Error("Error al obtener el proveedor de Firestore");
    }
  }

  /**
   * Busca proveedores por término en el campo nombre
   * Búsqueda case-insensitive (limitación de Firestore, se hace en cliente)
   */
  async searchProviders(termino: string): Promise<Proveedor[]> {
    try {
      const terminoLower = termino.toLowerCase().trim();

      if (terminoLower.length === 0) {
        return [];
      }

      // Obtener todos los proveedores activos
      const snapshot = await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .where("activo", "==", true)
        .get();

      if (snapshot.empty) {
        return [];
      }

      // Filtrar en cliente (Firestore no soporta búsqueda case-insensitive nativa)
      const proveedores: Proveedor[] = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        .filter((proveedor: any) => {
          const nombre = proveedor.nombre?.toLowerCase() || "";
          return nombre.includes(terminoLower);
        }) as Proveedor[];

      return proveedores;
    } catch (error) {
      console.error(`Error en searchProviders("${termino}"):`, error);
      throw new Error("Error al buscar proveedores en Firestore");
    }
  }

  /**
   * Crea un nuevo proveedor
   */
  async createProvider(proveedor: Omit<Proveedor, "id">): Promise<Proveedor> {
    try {
      // Validar que el nombre sea único
      const existingByName = await this.findProviderByName(proveedor.nombre);
      if (existingByName) {
        throw new Error(
          `Ya existe un proveedor con el nombre "${proveedor.nombre}"`,
        );
      }

      // Generar ID semántico basado en el nombre
      const docId = this.generateSemanticId(proveedor.nombre);

      // Verificar que el ID no exista
      const existingDoc = await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .doc(docId)
        .get();

      if (existingDoc.exists) {
        throw new Error(
          `Ya existe un proveedor con un nombre similar. Por favor, usa un nombre diferente.`,
        );
      }

      // Preparar datos con timestamps
      const nuevoProveedor = {
        ...proveedor,
        activo: proveedor.activo ?? true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Crear el documento
      await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .doc(docId)
        .set(nuevoProveedor);

      return {
        id: docId,
        ...proveedor,
        activo: proveedor.activo ?? true,
      };
    } catch (error) {
      console.error("Error en createProvider:", error);
      if (error instanceof Error && error.message.includes("Ya existe")) {
        throw error;
      }
      throw new Error("Error al crear el proveedor en Firestore");
    }
  }

  /**
   * Actualiza un proveedor existente
   */
  async updateProvider(
    id: string,
    updateData: Partial<Proveedor>,
  ): Promise<Proveedor> {
    try {
      // Verificar que el proveedor exista
      const existingProvider = await this.getProviderById(id);
      if (!existingProvider) {
        throw new Error(`Proveedor con ID "${id}" no encontrado`);
      }

      // Si se actualiza el nombre, validar que sea único
      if (updateData.nombre && updateData.nombre !== existingProvider.nombre) {
        const existingByName = await this.findProviderByName(updateData.nombre);
        if (existingByName && existingByName.id !== id) {
          throw new Error(
            `Ya existe otro proveedor con el nombre "${updateData.nombre}"`,
          );
        }
      }

      // Preparar datos de actualización
      const dataToUpdate = {
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Actualizar el documento
      await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .doc(id)
        .update(dataToUpdate);

      // Retornar proveedor actualizado
      return {
        ...existingProvider,
        ...updateData,
      };
    } catch (error) {
      console.error(`Error en updateProvider(${id}):`, error);
      if (
        error instanceof Error &&
        (error.message.includes("no encontrado") ||
          error.message.includes("Ya existe"))
      ) {
        throw error;
      }
      throw new Error("Error al actualizar el proveedor en Firestore");
    }
  }

  /**
   * Elimina un proveedor (soft delete)
   */
  async deleteProvider(id: string): Promise<void> {
    try {
      // Verificar que el proveedor exista
      const existingProvider = await this.getProviderById(id);
      if (!existingProvider) {
        throw new Error(`Proveedor con ID "${id}" no encontrado`);
      }

      // Soft delete: marcar como inactivo
      await firestoreTienda.collection(PROVEEDORES_COLLECTION).doc(id).update({
        activo: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`Error en deleteProvider(${id}):`, error);
      if (error instanceof Error && error.message.includes("no encontrado")) {
        throw error;
      }
      throw new Error("Error al eliminar el proveedor en Firestore");
    }
  }

  /**
   * Busca un proveedor por nombre (case-insensitive)
   * Helper method
   */
  private async findProviderByName(nombre: string): Promise<Proveedor | null> {
    try {
      const nombreLower = nombre.toLowerCase().trim();
      const snapshot = await firestoreTienda
        .collection(PROVEEDORES_COLLECTION)
        .where("activo", "==", true)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const found = snapshot.docs.find((doc) => {
        const data = doc.data();
        return data.nombre?.toLowerCase().trim() === nombreLower;
      });

      if (!found) {
        return null;
      }

      return {
        id: found.id,
        ...found.data(),
      } as Proveedor;
    } catch (error) {
      console.error("Error en findProviderByName:", error);
      return null;
    }
  }

  /**
   * Genera un ID semántico basado en el nombre
   * Helper method
   */
  private generateSemanticId(nombre: string): string {
    return nombre
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "");
  }
}

export default new ProviderService();
