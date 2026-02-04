import * as admin from "firebase-admin";
import { firestoreTienda } from "../config/firebase";
import { Categoria } from "../models/catalogo.model";

const CATEGORIAS_COLLECTION = "categorias";

/**
 * Servicio para gestionar operaciones CRUD de Categorías
 * Implementa soft delete y validación de unicidad de nombre
 */
class CategoryService {
  /**
   * Obtiene todas las categorías activas
   * @returns Array de categorías activas
   */
  async getAllCategories(): Promise<Categoria[]> {
    try {
      const snapshot = await firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .get();

      const categorias = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            nombre: data.nombre,
            lineaId: data.lineaId,
            orden: data.orden,
            activo: data.activo ?? true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Categoria & { activo: boolean; createdAt: any; updatedAt: any };
        })
        .filter((categoria) => categoria.activo);

      return categorias;
    } catch (error) {
      console.error("Error en CategoryService.getAllCategories:", error);
      throw error;
    }
  }

  /**
   * Obtiene una categoría por su ID
   * @param id - ID de la categoría
   * @returns Categoría encontrada o null si no existe o está inactiva
   */
  async getCategoryById(id: string): Promise<Categoria | null> {
    try {
      const doc = await firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data()!;

      // Retornar null si está marcada como inactiva (soft delete)
      if (data.activo === false) {
        return null;
      }

      return {
        id: doc.id,
        nombre: data.nombre,
        lineaId: data.lineaId,
        orden: data.orden,
      };
    } catch (error) {
      console.error(`Error en CategoryService.getCategoryById(${id}):`, error);
      throw error;
    }
  }

  /**
   * Busca categorías por término en el campo nombre
   * @param termino - Término de búsqueda (case-insensitive)
   * @returns Array de categorías que coinciden con el término
   */
  async searchCategories(termino: string): Promise<Categoria[]> {
    try {
      const term = termino.toLowerCase();
      const snapshot = await firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .get();

      const categorias = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            nombre: data.nombre,
            lineaId: data.lineaId,
            orden: data.orden,
            activo: data.activo ?? true,
          } as Categoria & { activo: boolean };
        })
        .filter(
          (categoria) =>
            categoria.activo && categoria.nombre.toLowerCase().includes(term),
        );

      return categorias;
    } catch (error) {
      console.error(
        `Error en CategoryService.searchCategories(${termino}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Crea una nueva categoría
   * Valida que el nombre sea único antes de crear
   * @param categoria - Datos de la categoría a crear
   * @returns Categoría creada con su ID generado
   * @throws Error si ya existe una categoría con el mismo nombre
   */
  async createCategory(
    categoria: Pick<Categoria, "nombre"> &
      Partial<Pick<Categoria, "lineaId" | "orden">>,
  ): Promise<Categoria> {
    try {
      const now = admin.firestore.Timestamp.now();

      // Validar que el nombre sea único
      const existingByNombre = await firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .where("nombre", "==", categoria.nombre)
        .limit(1)
        .get();

      if (!existingByNombre.empty) {
        throw new Error(
          `Ya existe una categoría con el nombre "${categoria.nombre}"`,
        );
      }

      // Generar ID semántico basado en el nombre
      const docId = categoria.nombre
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // Remover acentos

      const docRef = firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .doc(docId);

      // Verificar si ya existe un documento con ese ID
      const existingDoc = await docRef.get();
      if (existingDoc.exists) {
        throw new Error(
          `Ya existe una categoría con el nombre "${categoria.nombre}"`,
        );
      }

      // Crear el documento
      const categoriaData = {
        nombre: categoria.nombre,
        lineaId: categoria.lineaId || null,
        orden: categoria.orden || null,
        activo: true,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(categoriaData);

      return {
        id: docId,
        nombre: categoria.nombre,
        lineaId: categoria.lineaId,
        orden: categoria.orden,
      };
    } catch (error) {
      console.error("Error en CategoryService.createCategory:", error);
      throw error;
    }
  }

  /**
   * Actualiza una categoría existente
   * Valida unicidad de nombre si se está actualizando
   * @param id - ID de la categoría a actualizar
   * @param updateData - Datos a actualizar
   * @returns Categoría actualizada
   * @throws Error si la categoría no existe o el nombre ya está en uso
   */
  async updateCategory(
    id: string,
    updateData: Partial<Pick<Categoria, "nombre" | "lineaId" | "orden">>,
  ): Promise<Categoria> {
    try {
      const docRef = firestoreTienda.collection(CATEGORIAS_COLLECTION).doc(id);

      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Categoría con ID "${id}" no encontrada`);
      }

      // Validar unicidad de nombre si se está actualizando
      if (updateData.nombre !== undefined) {
        const existingByNombre = await firestoreTienda
          .collection(CATEGORIAS_COLLECTION)
          .where("nombre", "==", updateData.nombre)
          .limit(1)
          .get();

        if (!existingByNombre.empty && existingByNombre.docs[0].id !== id) {
          throw new Error(
            `Ya existe otra categoría con el nombre "${updateData.nombre}"`,
          );
        }
      }

      // Actualizar documento
      const dataToUpdate: any = {
        ...updateData,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      await docRef.update(dataToUpdate);

      // Obtener documento actualizado
      const updatedDoc = await docRef.get();
      const data = updatedDoc.data()!;

      return {
        id: updatedDoc.id,
        nombre: data.nombre,
        lineaId: data.lineaId,
        orden: data.orden,
      };
    } catch (error) {
      console.error(`Error en CategoryService.updateCategory(${id}):`, error);
      throw error;
    }
  }

  /**
   * Elimina una categoría (soft delete)
   * Marca la categoría como inactiva en lugar de eliminarla físicamente
   * @param id - ID de la categoría a eliminar
   * @throws Error si la categoría no existe
   */
  async deleteCategory(id: string): Promise<void> {
    try {
      const docRef = firestoreTienda.collection(CATEGORIAS_COLLECTION).doc(id);

      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Categoría con ID "${id}" no encontrada`);
      }

      // Soft delete: marcar como inactiva
      await docRef.update({
        activo: false,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    } catch (error) {
      console.error(`Error en CategoryService.deleteCategory(${id}):`, error);
      throw error;
    }
  }

  /**
   * Obtiene todas las categorías de una línea específica
   * @param lineaId - ID de la línea
   * @returns Array de categorías asociadas a la línea
   */
  async getCategoriesByLineId(lineaId: string): Promise<Categoria[]> {
    try {
      const snapshot = await firestoreTienda
        .collection(CATEGORIAS_COLLECTION)
        .where("lineaId", "==", lineaId)
        .get();

      const categorias = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            nombre: data.nombre,
            lineaId: data.lineaId,
            orden: data.orden,
            activo: data.activo ?? true,
          } as Categoria & { activo: boolean };
        })
        .filter((categoria) => categoria.activo);

      return categorias;
    } catch (error) {
      console.error(
        `Error en CategoryService.getCategoriesByLineId(${lineaId}):`,
        error,
      );
      throw error;
    }
  }
}

export default new CategoryService();
