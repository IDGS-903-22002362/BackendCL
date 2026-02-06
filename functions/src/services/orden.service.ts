/**
 * Servicio de Órdenes
 * Maneja toda la lógica de negocio relacionada con órdenes de compra
 *
 * IMPORTANTE:
 * - Recalcula totales en servidor (ignora valores del cliente por seguridad)
 * - IVA = 0% (simplificación temporal, cambiar cuando se requiera)
 * - Solo valida stock, NO reduce (implementar en TASK futura con transacciones)
 * - Sin autenticación por ahora (agregar cuando TASK-032 esté completa)
 */

import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  Orden,
  CrearOrdenDTO,
  EstadoOrden,
  ItemOrden,
} from "../models/orden.model";
import { Producto } from "../models/producto.model";
import { RolUsuario } from "../models/usuario.model";

/**
 * Colección de órdenes en Firestore
 */
const ORDENES_COLLECTION = "ordenes";
const PRODUCTOS_COLLECTION = "productos";

/**
 * Constantes de negocio
 */
const TASA_IVA = 0; // 0% temporal (cambiar a 0.16 cuando se requiera 16%)

/**
 * Clase OrdenService
 * Encapsula las operaciones de creación y gestión de órdenes
 */
export class OrdenService {
  /**
   * Crea una nueva orden de compra
   * REGLAS DE NEGOCIO:
   * - Valida existencia de todos los productos
   * - Valida stock disponible para cada producto
   * - Recalcula precios desde Firestore (ignora precios del cliente)
   * - Calcula subtotal, impuestos (0%) y total
   * - Establece estado PENDIENTE
   * - Genera timestamps automáticamente
   *
   * @param data - Datos de la orden (los totales y precios se recalculan)
   * @returns Promise con la orden creada incluyendo su ID de Firestore
   * @throws Error si:
   *   - Algún producto no existe
   *   - Algún producto no tiene stock suficiente
   *   - Error al guardar en Firestore
   */
  async createOrden(data: CrearOrdenDTO): Promise<Orden> {
    try {
      console.log(
        `📝 Creando orden para usuario: ${data.usuarioId} con ${data.items.length} items`,
      );

      // PASO 1: Validar y obtener información de todos los productos
      const itemsValidados: ItemOrden[] = [];
      let subtotalCalculado = 0;

      for (const item of data.items) {
        // Obtener producto desde Firestore
        const productoDoc = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(item.productoId)
          .get();

        // Validar existencia
        if (!productoDoc.exists) {
          throw new Error(
            `El producto con ID "${item.productoId}" no existe en el catálogo`,
          );
        }

        const producto = productoDoc.data() as Producto;

        // Validar que esté activo
        if (!producto.activo) {
          throw new Error(
            `El producto "${producto.descripcion}" no está disponible`,
          );
        }

        // Validar stock disponible
        if (producto.existencias < item.cantidad) {
          throw new Error(
            `Stock insuficiente para "${producto.descripcion}". ` +
              `Disponible: ${producto.existencias}, Solicitado: ${item.cantidad}`,
          );
        }

        // Recalcular precios desde el servidor (SEGURIDAD: ignorar valores del cliente)
        const precioUnitario = producto.precioPublico;
        const subtotalItem = precioUnitario * item.cantidad;

        // Construcción del item validado con precios del servidor
        const itemValidado: ItemOrden = {
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitario: precioUnitario, // Precio del servidor
          subtotal: subtotalItem, // Cálculo del servidor
          tallaId: item.tallaId, // Opcional
        };

        itemsValidados.push(itemValidado);
        subtotalCalculado += subtotalItem;

        console.log(
          `  ✓ Item validado: ${producto.descripcion} x${item.cantidad} = $${subtotalItem.toFixed(2)}`,
        );
      }

      // PASO 2: Calcular totales
      const impuestosCalculados = subtotalCalculado * TASA_IVA; // 0% por ahora
      const totalCalculado = subtotalCalculado + impuestosCalculados;

      console.log(`💰 Totales calculados:`);
      console.log(`   Subtotal: $${subtotalCalculado.toFixed(2)}`);
      console.log(
        `   Impuestos (${TASA_IVA * 100}%): $${impuestosCalculados.toFixed(2)}`,
      );
      console.log(`   Total: $${totalCalculado.toFixed(2)}`);

      // PASO 3: Construir orden con datos validados y calculados
      const now = admin.firestore.Timestamp.now();
      const nuevaOrden: Omit<Orden, "id"> = {
        usuarioId: data.usuarioId,
        items: itemsValidados,
        subtotal: subtotalCalculado, // Calculado por servidor
        impuestos: impuestosCalculados, // Calculado por servidor
        total: totalCalculado, // Calculado por servidor
        estado: EstadoOrden.PENDIENTE, // Siempre PENDIENTE al crear
        direccionEnvio: data.direccionEnvio,
        metodoPago: data.metodoPago,
        costoEnvio: data.costoEnvio || 0,
        notas: data.notas,
        createdAt: now,
        updatedAt: now,
      };

      // PASO 4: Guardar en Firestore
      const docRef = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .add(nuevaOrden);

      // PASO 5: Obtener documento creado con ID
      const ordenCreada: Orden = {
        id: docRef.id,
        ...nuevaOrden,
      };

      console.log(
        `✅ Orden creada exitosamente con ID: ${docRef.id} | Total: $${totalCalculado.toFixed(2)}`,
      );

      // TODO: En versión futura (con transacciones):
      // - Reducir stock de productos
      // - Enviar notificación al usuario
      // - Registrar en logs de auditoría

      return ordenCreada;
    } catch (error) {
      console.error("❌ Error al crear orden:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear la orden",
      );
    }
  }

  /**
   * Actualiza el estado de una orden existente
   * REGLAS DE NEGOCIO:
   * - Solo propietarios o admins pueden actualizar el estado
   * - Valida que la orden exista
   * - Valida ownership (BOLA prevention según AGENTS.MD)
   * - Admins/empleados pueden actualizar cualquier orden
   * - Clientes solo pueden actualizar sus propias órdenes
   * - Actualiza timestamp automáticamente
   * - Todas las transiciones de estado son permitidas (flexibilidad operativa)
   *
   * @param ordenId - ID de la orden a actualizar
   * @param nuevoEstado - Nuevo estado de la orden
   * @param usuarioActual - Usuario actual con uid y rol
   * @returns Promise con la orden actualizada
   * @throws Error si:
   *   - La orden no existe (404)
   *   - El usuario no tiene permisos (403 - BOLA prevention)
   *   - Error al actualizar en Firestore
   */
  async updateEstadoOrden(
    ordenId: string,
    nuevoEstado: EstadoOrden,
    usuarioActual: { uid: string; rol: RolUsuario },
  ): Promise<Orden> {
    try {
      console.log(
        `🔄 Actualizando estado de orden ${ordenId} a ${nuevoEstado} por usuario ${usuarioActual.uid}`,
      );

      // PASO 1: Obtener orden de Firestore
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();

      // PASO 2: Validar que la orden existe
      if (!ordenDoc.exists) {
        throw new Error(`La orden con ID "${ordenId}" no existe`);
      }

      const orden = ordenDoc.data() as Orden;

      // PASO 3: Validar OWNERSHIP (BOLA prevention)
      const esAdmin =
        usuarioActual.rol === RolUsuario.ADMIN ||
        usuarioActual.rol === RolUsuario.EMPLEADO;
      const esPropietario = orden.usuarioId === usuarioActual.uid;

      if (!esAdmin && !esPropietario) {
        throw new Error(
          "No tienes permisos para actualizar el estado de esta orden",
        );
      }

      console.log(
        `  ✓ Permisos validados: ${esAdmin ? "Admin" : "Propietario"}`,
      );

      // PASO 4: Actualizar estado en Firestore
      const now = admin.firestore.Timestamp.now();
      await firestoreTienda.collection(ORDENES_COLLECTION).doc(ordenId).update({
        estado: nuevoEstado,
        updatedAt: now,
      });

      // PASO 5: Retornar orden actualizada
      const ordenActualizada: Orden = {
        ...orden,
        id: ordenId,
        estado: nuevoEstado,
        updatedAt: now,
      };

      console.log(
        `✅ Estado de orden ${ordenId} actualizado exitosamente a ${nuevoEstado}`,
      );

      // TODO: Enviar notificación al usuario según nuevo estado (ÉPICA 11 - TASK-078 a 082)

      return ordenActualizada;
    } catch (error) {
      console.error("❌ Error al actualizar estado de orden:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar el estado de la orden",
      );
    }
  }

  /**
   * Obtiene todas las órdenes con filtros opcionales
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Clientes: solo ven sus propias órdenes (filtros.usuarioId es obligatorio)
   * - Admins/Empleados: pueden ver todas las órdenes
   *
   * FILTROS SOPORTADOS:
   * - usuarioId: string (obligatorio para clientes, opcional para admins)
   * - estados: string[] (múltiples estados)
   * - fechaDesde: string ISO 8601
   * - fechaHasta: string ISO 8601
   *
   * ORDENAMIENTO:
   * - Siempre por createdAt descendente (más recientes primero)
   *
   * @param filtros - Objeto con filtros opcionales
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con array de órdenes que cumplen los filtros
   */
  async getAllOrdenes(filtros: any, usuarioActual: any): Promise<Orden[]> {
    try {
      console.log("📋 Obteniendo órdenes con filtros:", filtros);

      // Construir query base
      let query: FirebaseFirestore.Query =
        firestoreTienda.collection(ORDENES_COLLECTION);

      // FILTRO 1: Por usuario (ownership)
      if (filtros.usuarioId) {
        query = query.where("usuarioId", "==", filtros.usuarioId);
      }

      // FILTRO 2: Por múltiples estados (usando 'in' operator)
      if (filtros.estados && Array.isArray(filtros.estados)) {
        // Firestore 'in' query soporta hasta 10 valores
        if (filtros.estados.length > 0 && filtros.estados.length <= 10) {
          query = query.where("estado", "in", filtros.estados);
        } else if (filtros.estados.length > 10) {
          console.warn(
            "⚠️ Firestore 'in' query limitado a 10 valores. Ignorando filtro de estados.",
          );
        }
      }

      // FILTRO 3: Por rango de fechas
      if (filtros.fechaDesde) {
        // Convertir ISO 8601 string a Firestore Timestamp
        const fechaDesdeDate = new Date(filtros.fechaDesde);
        const timestampDesde =
          admin.firestore.Timestamp.fromDate(fechaDesdeDate);
        query = query.where("createdAt", ">=", timestampDesde);
      }

      if (filtros.fechaHasta) {
        const fechaHastaDate = new Date(filtros.fechaHasta);
        const timestampHasta =
          admin.firestore.Timestamp.fromDate(fechaHastaDate);
        query = query.where("createdAt", "<=", timestampHasta);
      }

      // ORDENAMIENTO: Siempre por fecha descendente
      query = query.orderBy("createdAt", "desc");

      // Ejecutar query
      const snapshot = await query.get();

      // Mapear documentos a objetos Orden
      const ordenes: Orden[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          usuarioId: data.usuarioId,
          items: data.items,
          subtotal: data.subtotal,
          impuestos: data.impuestos,
          total: data.total,
          estado: data.estado as EstadoOrden,
          direccionEnvio: data.direccionEnvio,
          metodoPago: data.metodoPago,
          transaccionId: data.transaccionId,
          referenciaPago: data.referenciaPago,
          numeroGuia: data.numeroGuia,
          transportista: data.transportista,
          costoEnvio: data.costoEnvio,
          notas: data.notas,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      console.log(`✅ Se encontraron ${ordenes.length} órdenes`);
      return ordenes;
    } catch (error) {
      console.error("❌ Error al obtener órdenes:", error);

      // Detectar errores de índices faltantes de Firestore
      if (error instanceof Error && error.message.includes("index")) {
        console.error(
          "⚠️ ÍNDICE DE FIRESTORE FALTANTE. Ejecutar: firebase deploy --only firestore:indexes",
        );
        console.error(
          "   O crear índice desde la consola Firebase (el error incluye link)",
        );
      }

      throw new Error(
        error instanceof Error ? error.message : "Error al obtener las órdenes",
      );
    }
  }

  /**
   * Obtiene una orden específica por ID
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Valida que la orden exista
   * - Valida ownership: solo el propietario o admins pueden ver la orden
   *
   * @param ordenId - ID de la orden
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con la orden o null si no existe
   * @throws Error si el usuario no tiene permisos para ver la orden
   */
  async getOrdenById(
    ordenId: string,
    usuarioActual: any,
  ): Promise<Orden | null> {
    try {
      console.log(
        `📋 Obteniendo orden ${ordenId} para usuario ${usuarioActual.uid}`,
      );

      // Obtener documento de Firestore
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();

      // Validar existencia
      if (!ordenDoc.exists) {
        return null;
      }

      const data = ordenDoc.data();
      if (!data) {
        return null;
      }

      // VALIDACIÓN DE OWNERSHIP (BOLA Prevention)
      const userRole = usuarioActual.rol as RolUsuario;
      const esAdmin =
        userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;
      const esPropietario = data.usuarioId === usuarioActual.uid;

      if (!esAdmin && !esPropietario) {
        throw new Error(
          "No tienes permisos para acceder a esta orden. Solo puedes ver tus propias órdenes.",
        );
      }

      // Mapear a objeto Orden
      const orden: Orden = {
        id: ordenDoc.id,
        usuarioId: data.usuarioId,
        items: data.items,
        subtotal: data.subtotal,
        impuestos: data.impuestos,
        total: data.total,
        estado: data.estado as EstadoOrden,
        direccionEnvio: data.direccionEnvio,
        metodoPago: data.metodoPago,
        transaccionId: data.transaccionId,
        referenciaPago: data.referenciaPago,
        numeroGuia: data.numeroGuia,
        transportista: data.transportista,
        costoEnvio: data.costoEnvio,
        notas: data.notas,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };

      console.log(`✅ Orden ${ordenId} obtenida exitosamente`);
      return orden;
    } catch (error) {
      console.error(`❌ Error al obtener orden ${ordenId}:`, error);
      throw new Error(
        error instanceof Error ? error.message : "Error al obtener la orden",
      );
    }
  }

  /**
   * Obtiene una orden específica por ID con información populada
   * (productos y usuario)
   *
   * POPULATE:
   * - Información de productos: clave, descripción, imágenes
   * - Información de usuario: nombre, email, telefono
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Valida que la orden exista
   * - Valida ownership: solo el propietario o admins pueden ver la orden
   *
   * @param ordenId - ID de la orden
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con OrdenDetallada o null si no existe
   * @throws Error si el usuario no tiene permisos para ver la orden
   */
  async getOrdenByIdConPopulate(
    ordenId: string,
    usuarioActual: any,
  ): Promise<any> {
    try {
      console.log(
        `📋 Obteniendo orden ${ordenId} con populate para usuario ${usuarioActual.uid}`,
      );

      // PASO 1: Obtener orden base (incluye validación de ownership)
      const orden = await this.getOrdenById(ordenId, usuarioActual);

      if (!orden) {
        return null;
      }

      // PASO 2: Populate información de productos
      const itemsDetallados = await Promise.all(
        orden.items.map(async (item) => {
          try {
            const productoDoc = await firestoreTienda
              .collection(PRODUCTOS_COLLECTION)
              .doc(item.productoId)
              .get();

            if (productoDoc.exists) {
              const productoData = productoDoc.data();
              return {
                ...item,
                producto: {
                  clave: productoData?.clave || "N/A",
                  descripcion:
                    productoData?.descripcion || "Producto no disponible",
                  imagenes: productoData?.imagenes || [],
                },
              };
            } else {
              // Producto eliminado o no encontrado
              return {
                ...item,
                producto: {
                  clave: "N/A",
                  descripcion: "Producto no disponible",
                  imagenes: [],
                },
              };
            }
          } catch (error) {
            console.error(
              `Error al obtener producto ${item.productoId}:`,
              error,
            );
            return {
              ...item,
              producto: {
                clave: "ERROR",
                descripcion: "Error al cargar producto",
                imagenes: [],
              },
            };
          }
        }),
      );

      // PASO 3: Populate información de usuario
      let usuarioInfo = {
        nombre: "Usuario no disponible",
        email: "N/A",
        telefono: undefined,
      };

      try {
        const usuarioDoc = await firestoreTienda
          .collection("usuarios")
          .doc(orden.usuarioId)
          .get();

        if (usuarioDoc.exists) {
          const usuarioData = usuarioDoc.data();
          usuarioInfo = {
            nombre: usuarioData?.nombre || "Usuario",
            email: usuarioData?.email || "N/A",
            telefono: usuarioData?.telefono,
          };
        }
      } catch (error) {
        console.error(`Error al obtener usuario ${orden.usuarioId}:`, error);
        // Continuar con valores por defecto
      }

      // PASO 4: Construir respuesta con información populada
      const ordenDetallada = {
        ...orden,
        usuario: usuarioInfo,
        itemsDetallados: itemsDetallados,
      };

      console.log(`✅ Orden ${ordenId} obtenida con populate exitosamente`);
      return ordenDetallada;
    } catch (error) {
      console.error(
        `❌ Error al obtener orden ${ordenId} con populate:`,
        error,
      );
      throw new Error(
        error instanceof Error ? error.message : "Error al obtener la orden",
      );
    }
  }

  /**
   * TODO: Métodos futuros a implementar
   *
   * - cancelarOrden(): Cancelar orden y restaurar stock
   * - getOrdenesByUsuario(): Historial de órdenes de un usuario
   */
}

// Exportar instancia singleton
const ordenService = new OrdenService();
export default ordenService;
