/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
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
      const snapshot = await firestoreTienda
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
      const doc = await firestoreTienda
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
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("categoriaId", "==", categoriaId)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as Producto,
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
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("lineaId", "==", lineaId)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as Producto,
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

      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs
        .map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            }) as Producto,
        )
        .filter(
          (producto) =>
            producto.descripcion.toLowerCase().includes(searchTermLower) ||
            producto.clave.toLowerCase().includes(searchTermLower),
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
    productoData: Omit<Producto, "id" | "createdAt" | "updatedAt">,
  ): Promise<Producto> {
    try {
      const now = admin.firestore.Timestamp.now();

      // Validar que la clave no exista
      const existingProduct = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("clave", "==", productoData.clave)
        .limit(1)
        .get();

      if (!existingProduct.empty) {
        throw new Error(
          `Ya existe un producto con la clave: ${productoData.clave}`,
        );
      }

      // Crear el documento con timestamps
      const docRef = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .add({
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
        `Producto creado: ${nuevoProducto.descripcion} (ID: ${nuevoProducto.id})`,
      );
      return nuevoProducto;
    } catch (error) {
      console.error("❌ Error al crear producto:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear el producto",
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
    updateData: Partial<Omit<Producto, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Producto> {
    try {
      const docRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Producto con ID ${id} no encontrado`);
      }

      // Si se intenta actualizar la clave, validar que no exista
      if (updateData.clave) {
        const existingProduct = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .where("clave", "==", updateData.clave)
          .limit(1)
          .get();

        if (!existingProduct.empty && existingProduct.docs[0].id !== id) {
          throw new Error(
            `Ya existe otro producto con la clave: ${updateData.clave}`,
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
          : "Error al actualizar el producto",
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
      const docRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id);
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
        error instanceof Error
          ? error.message
          : "Error al eliminar el producto",
      );
    }
  }

  /**
   * Reduce el stock de un producto de manera atómica usando transacciones Firestore
   * REGLAS DE NEGOCIO (AGENTS.MD sección 9):
   * - Usa transacciones para atomicidad (evita race conditions)
   * - Valida que el producto exista
   * - Valida que haya stock suficiente
   * - Actualiza existencias y timestamp
   *
   * @param productoId - ID del producto
   * @param cantidad - Cantidad a reducir
   * @throws Error si:
   *   - El producto no existe
   *   - No hay stock suficiente
   *   - Error en la transacción
   */
  async decrementStock(productoId: string, cantidad: number): Promise<void> {
    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      await firestoreTienda.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          throw new Error(
            `Producto con ID "${productoId}" no encontrado al reducir stock`,
          );
        }

        const producto = doc.data() as Producto;
        const existenciasActuales = producto.existencias || 0;

        if (existenciasActuales < cantidad) {
          throw new Error(
            `Stock insuficiente para el producto "${producto.descripcion}". ` +
              `Disponible: ${existenciasActuales}, Solicitado: ${cantidad}`,
          );
        }

        const nuevasExistencias = existenciasActuales - cantidad;

        transaction.update(docRef, {
          existencias: nuevasExistencias,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(
          `✅ Stock reducido: ${producto.descripcion} | ${existenciasActuales} → ${nuevasExistencias}`,
        );
      });
    } catch (error) {
      console.error(
        `❌ Error al reducir stock de producto ${productoId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Incrementa el stock de un producto de manera atómica usando transacciones Firestore
   * Usado para restaurar stock al cancelar órdenes
   * REGLAS DE NEGOCIO (AGENTS.MD sección 9):
   * - Usa transacciones para atomicidad
   * - Valida que el producto exista
   * - Actualiza existencias y timestamp
   *
   * @param productoId - ID del producto
   * @param cantidad - Cantidad a incrementar
   * @throws Error si:
   *   - El producto no existe
   *   - Error en la transacción
   */
  async incrementStock(productoId: string, cantidad: number): Promise<void> {
    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      await firestoreTienda.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          throw new Error(
            `Producto con ID "${productoId}" no encontrado al incrementar stock`,
          );
        }

        const producto = doc.data() as Producto;
        const existenciasActuales = producto.existencias || 0;
        const nuevasExistencias = existenciasActuales + cantidad;

        transaction.update(docRef, {
          existencias: nuevasExistencias,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(
          `✅ Stock restaurado: ${producto.descripcion} | ${existenciasActuales} → ${nuevasExistencias}`,
        );
      });
    } catch (error) {
      console.error(
        `❌ Error al incrementar stock de producto ${productoId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Restaura el stock de múltiples productos a partir de items de una orden
   * Usado al cancelar órdenes para devolver productos al inventario
   * REGLAS DE NEGOCIO:
   * - Procesa items secuencialmente (Firestore no soporta transacciones paralelas)
   * - Si un producto falla, intenta restaurar los demás
   * - Loggea errores pero no detiene el proceso
   *
   * @param items - Array de items de la orden con productoId y cantidad
   * @returns Promise<void>
   */
  async restoreStockFromOrder(
    items: Array<{ productoId: string; cantidad: number }>,
  ): Promise<void> {
    console.log(`🔄 Restaurando stock para ${items.length} productos...`);

    const errores: string[] = [];

    for (const item of items) {
      try {
        await this.incrementStock(item.productoId, item.cantidad);
      } catch (error) {
        const mensaje = `Error al restaurar stock de ${item.productoId}: ${error instanceof Error ? error.message : "Error desconocido"}`;
        console.error(`⚠️ ${mensaje}`);
        errores.push(mensaje);
        // Continuar con los siguientes productos aunque uno falle
      }
    }

    if (errores.length > 0) {
      console.warn(
        `⚠️ Restauración de stock completada con ${errores.length} errores`,
      );
      // No lanzar error para evitar bloquear la cancelación
      // Los errores se loggean para auditoría
    } else {
      console.log(`✅ Stock restaurado exitosamente para todos los productos`);
    }
  }
}

// Exportar instancia única del servicio (Singleton)
export default new ProductService();
