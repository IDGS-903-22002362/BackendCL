/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestore, admin } from "../config/firebase";
import { Producto } from "../models/producto.model";

/**
 * Colección de productos en Firestore
 */
const PRODUCTOS_COLLECTION = "productos";

/**
 * Clase ProductService
 * Encapsula las operaciones CRUD y consultas de productos
 */
export class ProductService {
  /**
   * Obtiene todos los productos activos
   * @returns Promise con array de productos activos ordenados alfabéticamente
   */
  async getAllProducts(): Promise<Producto[]> {
    try {
      // Consultar colección de productos (sin orderBy para evitar índice compuesto)
      const snapshot = await firestore
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true) // Filtrar solo productos activos
        .get();

      // Si no hay productos, retornar array vacío
      if (snapshot.empty) {
        console.log("No se encontraron productos activos");
        return [];
      }

      // Mapear documentos a objetos Producto
      const productos: Producto[] = snapshot.docs.map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,
          clave: data.clave,
          descripcion: data.descripcion,
          lineaId: data.lineaId,
          categoriaId: data.categoriaId,
          precioPublico: data.precioPublico,
          precioCompra: data.precioCompra,
          existencias: data.existencias,
          proveedorId: data.proveedorId,
          tallaIds: data.tallaIds || [],
          imagenes: data.imagenes || [],
          activo: data.activo,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        } as Producto;
      });

      // Ordenar alfabéticamente en memoria
      productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

      console.log(`Se obtuvieron ${productos.length} productos activos`);
      return productos;
    } catch (error) {
      console.error("Error al obtener productos:", error);
      throw new Error("Error al obtener productos de la base de datos");
    }
  }

  /**
   * Obtiene un producto por su ID
   * @param id - ID del documento en Firestore
   * @returns Promise con el producto o null si no existe
   */
  async getProductById(id: string): Promise<Producto | null> {
    try {
      const doc = await firestore
        .collection(PRODUCTOS_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        console.log(`Producto con ID ${id} no encontrado`);
        return null;
      }

      const data = doc.data()!;
      return {
        id: doc.id,
        clave: data.clave,
        descripcion: data.descripcion,
        lineaId: data.lineaId,
        categoriaId: data.categoriaId,
        precioPublico: data.precioPublico,
        precioCompra: data.precioCompra,
        existencias: data.existencias,
        proveedorId: data.proveedorId,
        tallaIds: data.tallaIds || [],
        imagenes: data.imagenes || [],
        activo: data.activo,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } as Producto;
    } catch (error) {
      console.error(`❌ Error al obtener producto ${id}:`, error);
      throw new Error("Error al obtener el producto");
    }
  }

  /**
   * Obtiene productos por categoría
   * @param categoriaId - ID de la categoría
   * @returns Promise con array de productos de la categoría
   */
  async getProductsByCategory(categoriaId: string): Promise<Producto[]> {
    try {
      const snapshot = await firestore
        .collection(PRODUCTOS_COLLECTION)
        .where("categoriaId", "==", categoriaId)
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
      console.error("❌ Error al obtener productos por categoría:", error);
      throw new Error("Error al obtener productos por categoría");
    }
  }

  /**
   * Obtiene productos por línea
   * @param lineaId - ID de la línea
   * @returns Promise con array de productos de la línea
   */
  async getProductsByLine(lineaId: string): Promise<Producto[]> {
    try {
      const snapshot = await firestore
        .collection(PRODUCTOS_COLLECTION)
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

  /**
   * Busca productos por texto en descripción o clave
   * @param searchTerm - Término de búsqueda
   * @returns Promise con array de productos que coinciden
   */
  async searchProducts(searchTerm: string): Promise<Producto[]> {
    try {
      // Nota: Firestore no tiene búsqueda full-text nativa
      // Esta es una implementación básica que busca por inicio de descripción
      // Para búsqueda más avanzada, considerar usar Algolia o similar

      const searchTermLower = searchTerm.toLowerCase();

      const snapshot = await firestore
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs
        .map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as Producto)
        )
        .filter(
          (producto) =>
            producto.descripcion.toLowerCase().includes(searchTermLower) ||
            producto.clave.toLowerCase().includes(searchTermLower)
        );

      return productos;
    } catch (error) {
      console.error("❌ Error al buscar productos:", error);
      throw new Error("Error al buscar productos");
    }
  }

  /**
   * Crea un nuevo producto
   * @param productoData - Datos del producto a crear
   * @returns Promise con el producto creado incluyendo su ID
   */
  async createProduct(
    productoData: Omit<Producto, "id" | "createdAt" | "updatedAt">
  ): Promise<Producto> {
    try {
      const now = admin.firestore.Timestamp.now();

      // Validar que la clave no exista
      const existingProduct = await firestore
        .collection(PRODUCTOS_COLLECTION)
        .where("clave", "==", productoData.clave)
        .limit(1)
        .get();

      if (!existingProduct.empty) {
        throw new Error(
          `Ya existe un producto con la clave: ${productoData.clave}`
        );
      }

      // Crear el documento con timestamps
      const docRef = await firestore.collection(PRODUCTOS_COLLECTION).add({
        ...productoData,
        createdAt: now,
        updatedAt: now,
      });

      // Obtener el documento creado
      const docSnapshot = await docRef.get();
      const data = docSnapshot.data()!;

      const nuevoProducto: Producto = {
        id: docRef.id,
        ...data,
      } as Producto;

      console.log(
        `Producto creado: ${nuevoProducto.descripcion} (ID: ${nuevoProducto.id})`
      );
      return nuevoProducto;
    } catch (error) {
      console.error("❌ Error al crear producto:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear el producto"
      );
    }
  }

  /**
   * Actualiza un producto existente
   * @param id - ID del producto a actualizar
   * @param updateData - Datos a actualizar
   * @returns Promise con el producto actualizado
   */
  async updateProduct(
    id: string,
    updateData: Partial<Omit<Producto, "id" | "createdAt" | "updatedAt">>
  ): Promise<Producto> {
    try {
      const docRef = firestore.collection(PRODUCTOS_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Producto con ID ${id} no encontrado`);
      }

      // Si se intenta actualizar la clave, validar que no exista
      if (updateData.clave) {
        const existingProduct = await firestore
          .collection(PRODUCTOS_COLLECTION)
          .where("clave", "==", updateData.clave)
          .limit(1)
          .get();

        if (!existingProduct.empty && existingProduct.docs[0].id !== id) {
          throw new Error(
            `Ya existe otro producto con la clave: ${updateData.clave}`
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
      const updatedProducto: Producto = {
        id: updatedDoc.id,
        ...updatedDoc.data(),
      } as Producto;

      console.log(`Producto actualizado: ${updatedProducto.descripcion}`);
      return updatedProducto;
    } catch (error) {
      console.error("Error al actualizar producto:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar el producto"
      );
    }
  }

  /**
   * Elimina un producto (soft delete - marca como inactivo)
   * @param id - ID del producto a eliminar
   * @returns Promise<void>
   */
  async deleteProduct(id: string): Promise<void> {
    try {
      const docRef = firestore.collection(PRODUCTOS_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Producto con ID ${id} no encontrado`);
      }

      // Soft delete: marcar como inactivo
      const now = admin.firestore.Timestamp.now();
      await docRef.update({
        activo: false,
        updatedAt: now,
      });

      console.log(`Producto eliminado (inactivo): ID ${id}`);
    } catch (error) {
      console.error("Error al eliminar producto:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al eliminar el producto"
      );
    }
  }
}

// Exportar instancia única del servicio (Singleton)
export default new ProductService();
