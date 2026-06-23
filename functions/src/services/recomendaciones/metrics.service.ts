import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  RecomendacionEvento,
  RecomendacionEventoTipo,
  RecomendacionMetricasDiarias,
} from "../../models/recomendaciones.model";
import { recomendacionCollections } from "./collections";

class MetricsService {
  private formatDateKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  async incrementFromEvent(event: RecomendacionEvento): Promise<void> {
    const fecha = this.formatDateKey(event.createdAt.toDate());
    const docRef = firestoreTienda.collection(recomendacionCollections.metricas).doc(fecha);
    const estrategia = event.estrategia || "unknown";

    const increments: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
    };

    switch (event.tipo) {
      case RecomendacionEventoTipo.IMPRESION_RECOMENDACION:
        increments.impresiones = FieldValue.increment(1);
        increments[`porEstrategia.${estrategia}.impresiones`] = FieldValue.increment(1);
        break;
      case RecomendacionEventoTipo.CLIC_RECOMENDACION:
      case RecomendacionEventoTipo.CLIC_PRODUCTO:
        increments.clics = FieldValue.increment(1);
        increments[`porEstrategia.${estrategia}.clics`] = FieldValue.increment(1);
        break;
      case RecomendacionEventoTipo.AGREGAR_CARRITO:
        increments.agregadosCarrito = FieldValue.increment(1);
        increments[`porEstrategia.${estrategia}.agregadosCarrito`] = FieldValue.increment(1);
        break;
      case RecomendacionEventoTipo.COMPRA:
        increments.compras = FieldValue.increment(1);
        increments[`porEstrategia.${estrategia}.compras`] = FieldValue.increment(1);
        if (event.metadata?.atribuidoRecomendacion === true) {
          increments.conversionesAtribuidas = FieldValue.increment(1);
        }
        break;
      default:
        return;
    }

    await docRef.set(
      {
        id: fecha,
        fecha,
        impresiones: 0,
        clics: 0,
        agregadosCarrito: 0,
        compras: 0,
        conversionesAtribuidas: 0,
        porEstrategia: {},
        ...increments,
      },
      { merge: true },
    );
  }

  async getMetricsRange(days = 30): Promise<RecomendacionMetricasDiarias[]> {
    const cutoff = this.formatDateKey(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    );

    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.metricas)
      .where("fecha", ">=", cutoff)
      .orderBy("fecha", "desc")
      .limit(days)
      .get();

    return snapshot.docs.map((doc) => doc.data() as RecomendacionMetricasDiarias);
  }
}

export default new MetricsService();
