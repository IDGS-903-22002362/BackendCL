/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { InventarioPorTalla, Producto } from "../models/producto.model";

/**
 * Colección de productos en Firestore
 */
const PRODUCTOS_COLLECTION = "productos";
const MOVIMIENTOS_INVENTARIO_COLLECTION = "movimientosInventario";

export interface UpdateProductStockDTO {
  cantidadNueva: number;
  tallaId?: string;
  tipo?: "entrada" | "salida" | "ajuste" | "venta" | "devolucion";
  motivo?: string;
  referencia?: string;
  usuarioId?: string;
}

export interface ProductStockUpdateResult {
  productoId: string;
  tallaId: string | null;
  cantidadAnterior: number;
  cantidadNueva: number;
  diferencia: number;
  existencias: number;
  inventarioPorTalla: InventarioPorTalla[];
}

/**
 * Clase ProductService
 * Encapsula las operaciones CRUD y consultas de productos
 */
export class ProductService {
  private normalizeInventoryBySize(
    inventarioPorTalla: unknown,
  ): InventarioPorTalla[] {
    if (!Array.isArray(inventarioPorTalla)) {
      return [];
    }

    return inventarioPorTalla
      .filter(
        (item): item is { tallaId: unknown; cantidad: unknown } =>
          typeof item === "object" && item !== null,
      )
      .map((item) => {
        const tallaId = String(item.tallaId ?? "").trim();
        const cantidadRaw = Number(item.cantidad ?? 0);
        const cantidad =
          Number.isFinite(cantidadRaw) && cantidadRaw > 0
            ? Math.floor(cantidadRaw)
            : 0;

        return {
          tallaId,
          cantidad,
        };
      })
      .filter((item) => item.tallaId.length > 0);
  }

  private getDerivedExistencias(
    inventarioPorTalla: InventarioPorTalla[],
    fallbackExistencias?: number,
  ): number {
    if (inventarioPorTalla.length === 0) {
      return Math.max(0, Math.floor(Number(fallbackExistencias ?? 0)));
    }

    return inventarioPorTalla.reduce((acc, item) => acc + item.cantidad, 0);
  }

  private getMergedTallaIds(
    tallaIds: string[] = [],
    inventarioPorTalla: InventarioPorTalla[] = [],
  ): string[] {
    const ids = [...tallaIds, ...inventarioPorTalla.map((item) => item.tallaId)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    return [...new Set(ids)];
  }

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
          inventarioPorTalla: this.normalizeInventoryBySize(
            data.inventarioPorTalla,
          ),
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
        inventarioPorTalla: this.normalizeInventoryBySize(
          data.inventarioPorTalla,
        ),
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
      const inventarioPorTalla = this.normalizeInventoryBySize(
        productoData.inventarioPorTalla,
      );
      const tallaIds = this.getMergedTallaIds(
        productoData.tallaIds,
        inventarioPorTalla,
      );
      const existencias = this.getDerivedExistencias(
        inventarioPorTalla,
        productoData.existencias,
      );

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
          tallaIds,
          inventarioPorTalla,
          existencias,
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
      const productoActual = doc.data() as Producto;

      const inventarioPorTalla =
        updateData.inventarioPorTalla !== undefined
          ? this.normalizeInventoryBySize(updateData.inventarioPorTalla)
          : this.normalizeInventoryBySize(productoActual.inventarioPorTalla);

      const shouldDeriveFromInventory =
        updateData.inventarioPorTalla !== undefined ||
        this.normalizeInventoryBySize(productoActual.inventarioPorTalla)
          .length > 0;

      const payload: Partial<Omit<Producto, "id" | "createdAt">> = {
        ...updateData,
        updatedAt: now,
      };

      if (updateData.inventarioPorTalla !== undefined) {
        payload.inventarioPorTalla = inventarioPorTalla;
      }

      if (
        updateData.tallaIds !== undefined ||
        updateData.inventarioPorTalla !== undefined
      ) {
        payload.tallaIds = this.getMergedTallaIds(
          updateData.tallaIds ?? productoActual.tallaIds ?? [],
          inventarioPorTalla,
        );
      }

      if (shouldDeriveFromInventory) {
        payload.existencias = this.getDerivedExistencias(
          inventarioPorTalla,
          updateData.existencias ?? productoActual.existencias,
        );
      }

      await docRef.update({
        ...payload,
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

  async getStockBySize(id: string): Promise<{
    productoId: string;
    existencias: number;
    inventarioPorTalla: InventarioPorTalla[];
  } | null> {
    try {
      const doc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data()!;
      const inventarioPorTalla = this.normalizeInventoryBySize(
        data.inventarioPorTalla,
      );

      return {
        productoId: doc.id,
        existencias: this.getDerivedExistencias(
          inventarioPorTalla,
          data.existencias,
        ),
        inventarioPorTalla,
      };
    } catch (error) {
      console.error(
        `❌ Error al obtener stock por talla de producto ${id}:`,
        error,
      );
      throw new Error("Error al obtener stock por talla del producto");
    }
  }

  /**
   * Actualiza stock de un producto de forma atómica y registra movimiento de inventario.
   * - Si el producto usa inventario por talla, requiere tallaId.
   * - Si no usa inventario por talla, actualiza existencias generales.
   * - Registra movimiento en colección `movimientosInventario`.
   */
  async updateStock(
    productoId: string,
    payload: UpdateProductStockDTO,
  ): Promise<ProductStockUpdateResult> {
    const cantidadNueva = Math.floor(Number(payload.cantidadNueva));

    if (!Number.isFinite(cantidadNueva) || cantidadNueva < 0) {
      throw new Error("La nueva cantidad no puede ser negativa");
    }

    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      const result = await firestoreTienda.runTransaction(
        async (transaction) => {
          const snapshot = await transaction.get(docRef);

          if (!snapshot.exists) {
            throw new Error(`Producto con ID ${productoId} no encontrado`);
          }

          const data = snapshot.data() as Producto;
          const now = admin.firestore.Timestamp.now();

          const inventarioPorTallaActual = this.normalizeInventoryBySize(
            data.inventarioPorTalla,
          );
          const usaInventarioPorTalla = inventarioPorTallaActual.length > 0;

          let tallaIdMovimiento: string | null = null;
          let cantidadAnterior = 0;
          let inventarioPorTallaActualizado = inventarioPorTallaActual;
          let existenciasActualizadas = Math.max(
            0,
            Math.floor(Number(data.existencias ?? 0)),
          );

          if (usaInventarioPorTalla) {
            const tallaId = payload.tallaId?.trim();

            if (!tallaId) {
              throw new Error(
                "Se requiere tallaId para actualizar stock por talla en este producto",
              );
            }

            const tallaIdsProducto = Array.isArray(data.tallaIds)
              ? data.tallaIds.map((id) => String(id).trim())
              : [];

            if (
              tallaIdsProducto.length > 0 &&
              !tallaIdsProducto.includes(tallaId)
            ) {
              throw new Error(
                `La talla \"${tallaId}\" no pertenece al producto ${productoId}`,
              );
            }

            const tallaIndex = inventarioPorTallaActual.findIndex(
              (item) => item.tallaId === tallaId,
            );

            tallaIdMovimiento = tallaId;
            cantidadAnterior =
              tallaIndex >= 0
                ? inventarioPorTallaActual[tallaIndex].cantidad
                : 0;

            if (tallaIndex >= 0) {
              inventarioPorTallaActualizado = [...inventarioPorTallaActual];
              inventarioPorTallaActualizado[tallaIndex] = {
                ...inventarioPorTallaActualizado[tallaIndex],
                cantidad: cantidadNueva,
              };
            } else {
              inventarioPorTallaActualizado = [
                ...inventarioPorTallaActual,
                { tallaId, cantidad: cantidadNueva },
              ];
            }

            existenciasActualizadas = this.getDerivedExistencias(
              inventarioPorTallaActualizado,
              data.existencias,
            );

            transaction.update(docRef, {
              inventarioPorTalla: inventarioPorTallaActualizado,
              tallaIds: this.getMergedTallaIds(
                data.tallaIds || [],
                inventarioPorTallaActualizado,
              ),
              existencias: existenciasActualizadas,
              updatedAt: now,
            });
          } else {
            if (payload.tallaId) {
              throw new Error(
                "Este producto no maneja inventario por talla; actualiza stock general sin tallaId",
              );
            }

            cantidadAnterior = existenciasActualizadas;
            existenciasActualizadas = cantidadNueva;

            transaction.update(docRef, {
              existencias: existenciasActualizadas,
              updatedAt: now,
            });
          }

          const diferencia = cantidadNueva - cantidadAnterior;

          const movimientoRef = firestoreTienda
            .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
            .doc();

          transaction.set(movimientoRef, {
            productoId,
            tallaId: tallaIdMovimiento,
            cantidadAnterior,
            cantidadNueva,
            diferencia,
            tipo: payload.tipo ?? "ajuste",
            motivo: payload.motivo,
            referencia: payload.referencia,
            usuarioId: payload.usuarioId,
            createdAt: now,
          });

          return {
            productoId,
            tallaId: tallaIdMovimiento,
            cantidadAnterior,
            cantidadNueva,
            diferencia,
            existencias: existenciasActualizadas,
            inventarioPorTalla: inventarioPorTallaActualizado,
          } as ProductStockUpdateResult;
        },
      );

      return result;
    } catch (error) {
      console.error(
        `❌ Error al actualizar stock de producto ${productoId}:`,
        error,
      );
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar stock del producto",
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
