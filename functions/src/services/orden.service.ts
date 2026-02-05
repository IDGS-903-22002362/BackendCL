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
   * TODO: Métodos futuros a implementar
   *
   * - getAllOrdenes(): Listar todas las órdenes con filtros
   * - getOrdenById(): Obtener orden por ID
   * - updateEstadoOrden(): Actualizar estado de orden
   * - cancelarOrden(): Cancelar orden y restaurar stock
   * - getOrdenesByUsuario(): Historial de órdenes de un usuario
   */
}

// Exportar instancia singleton
const ordenService = new OrdenService();
export default ordenService;
