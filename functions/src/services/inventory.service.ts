import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  ListarMovimientosInventarioQuery,
  MovimientoInventario,
  RegistrarMovimientoInventarioDTO,
  TipoMovimientoInventario,
} from "../models/inventario.model";
import productService from "./product.service";

const MOVIMIENTOS_INVENTARIO_COLLECTION = "movimientosInventario";
const ORDENES_COLLECTION = "ordenes";

class InventoryService {
  private async getCantidadActual(
    productoId: string,
    tallaId?: string,
  ): Promise<{ cantidadActual: number; tallaIdFinal: string | null }> {
    const stock = await productService.getStockBySize(productoId);

    if (!stock) {
      throw new Error(`Producto con ID ${productoId} no encontrado`);
    }

    if (stock.inventarioPorTalla.length > 0) {
      if (!tallaId) {
        throw new Error(
          "Se requiere tallaId para registrar movimiento en productos con inventario por talla",
        );
      }

      const registroTalla = stock.inventarioPorTalla.find(
        (item) => item.tallaId === tallaId,
      );

      return {
        cantidadActual: registroTalla?.cantidad ?? 0,
        tallaIdFinal: tallaId,
      };
    }

    if (tallaId) {
      throw new Error(
        "Este producto no maneja inventario por talla; no envíes tallaId",
      );
    }

    return {
      cantidadActual: stock.existencias,
      tallaIdFinal: null,
    };
  }

  private async validateOrdenIfNeeded(
    tipo: TipoMovimientoInventario,
    ordenId?: string,
  ): Promise<void> {
    if (
      tipo !== TipoMovimientoInventario.VENTA &&
      tipo !== TipoMovimientoInventario.DEVOLUCION
    ) {
      return;
    }

    if (!ordenId) {
      throw new Error(
        "ordenId es requerido para movimientos tipo venta o devolucion",
      );
    }

    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(ordenId)
      .get();
    if (!ordenDoc.exists) {
      throw new Error(`Orden con ID ${ordenId} no encontrada`);
    }
  }

  private calcularCantidadNueva(
    tipo: TipoMovimientoInventario,
    cantidadActual: number,
    payload: RegistrarMovimientoInventarioDTO,
  ): number {
    if (tipo === TipoMovimientoInventario.AJUSTE) {
      if (payload.cantidadNueva === undefined) {
        throw new Error(
          "Para movimientos tipo ajuste se requiere cantidadNueva",
        );
      }
      return payload.cantidadNueva;
    }

    if (payload.cantidad === undefined) {
      throw new Error("La cantidad es requerida para este tipo de movimiento");
    }

    if (
      tipo === TipoMovimientoInventario.ENTRADA ||
      tipo === TipoMovimientoInventario.DEVOLUCION
    ) {
      return cantidadActual + payload.cantidad;
    }

    const cantidadNueva = cantidadActual - payload.cantidad;
    if (cantidadNueva < 0) {
      throw new Error("Stock insuficiente para registrar el movimiento");
    }

    return cantidadNueva;
  }

  async registerMovement(
    payload: RegistrarMovimientoInventarioDTO,
  ): Promise<MovimientoInventario> {
    const tipo = payload.tipo;
    const tallaId = payload.tallaId?.trim();

    await this.validateOrdenIfNeeded(tipo, payload.ordenId);

    const { cantidadActual, tallaIdFinal } = await this.getCantidadActual(
      payload.productoId,
      tallaId,
    );

    const cantidadNueva = this.calcularCantidadNueva(
      tipo,
      cantidadActual,
      payload,
    );

    const stockResult = await productService.updateStock(payload.productoId, {
      cantidadNueva,
      tallaId: tallaIdFinal ?? undefined,
      tipo,
      motivo: payload.motivo,
      referencia: payload.referencia,
      ordenId: payload.ordenId,
      usuarioId: payload.usuarioId,
    });

    return {
      id: stockResult.movimientoId,
      tipo,
      productoId: stockResult.productoId,
      tallaId: stockResult.tallaId,
      cantidadAnterior: stockResult.cantidadAnterior,
      cantidadNueva: stockResult.cantidadNueva,
      diferencia: stockResult.diferencia,
      motivo: payload.motivo,
      referencia: payload.referencia,
      ordenId: payload.ordenId,
      usuarioId: payload.usuarioId,
      createdAt: stockResult.createdAt,
    };
  }

  async listMovements(
    queryParams: ListarMovimientosInventarioQuery,
  ): Promise<{
    movimientos: MovimientoInventario[];
    nextCursor: string | null;
  }> {
    try {
      let query: FirebaseFirestore.Query = firestoreTienda.collection(
        MOVIMIENTOS_INVENTARIO_COLLECTION,
      );

      if (queryParams.productoId) {
        query = query.where("productoId", "==", queryParams.productoId);
      }

      if (queryParams.tallaId) {
        query = query.where("tallaId", "==", queryParams.tallaId);
      }

      if (queryParams.tipo) {
        query = query.where("tipo", "==", queryParams.tipo);
      }

      if (queryParams.ordenId) {
        query = query.where("ordenId", "==", queryParams.ordenId);
      }

      if (queryParams.usuarioId) {
        query = query.where("usuarioId", "==", queryParams.usuarioId);
      }

      if (queryParams.fechaDesde) {
        query = query.where(
          "createdAt",
          ">=",
          admin.firestore.Timestamp.fromDate(new Date(queryParams.fechaDesde)),
        );
      }

      if (queryParams.fechaHasta) {
        query = query.where(
          "createdAt",
          "<=",
          admin.firestore.Timestamp.fromDate(new Date(queryParams.fechaHasta)),
        );
      }

      query = query.orderBy("createdAt", "desc");

      if (queryParams.cursor) {
        const cursorDoc = await firestoreTienda
          .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
          .doc(queryParams.cursor)
          .get();

        if (!cursorDoc.exists) {
          throw new Error(
            `Cursor inválido: movimiento con ID \"${queryParams.cursor}\" no existe`,
          );
        }

        query = query.startAfter(cursorDoc);
      }

      query = query.limit(queryParams.limit + 1);

      const snapshot = await query.get();
      const hasNextPage = snapshot.docs.length > queryParams.limit;
      const docs = hasNextPage
        ? snapshot.docs.slice(0, queryParams.limit)
        : snapshot.docs;

      const movimientos = docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          tipo: data.tipo,
          productoId: data.productoId,
          tallaId: data.tallaId ?? null,
          cantidadAnterior: data.cantidadAnterior,
          cantidadNueva: data.cantidadNueva,
          diferencia: data.diferencia,
          motivo: data.motivo,
          referencia: data.referencia,
          ordenId: data.ordenId,
          usuarioId: data.usuarioId,
          createdAt: data.createdAt,
        } as MovimientoInventario;
      });

      return {
        movimientos,
        nextCursor: hasNextPage ? docs[docs.length - 1].id : null,
      };
    } catch (error) {
      console.error("❌ Error al consultar movimientos de inventario:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al consultar movimientos de inventario",
      );
    }
  }
}

export const inventoryService = new InventoryService();
export default inventoryService;
