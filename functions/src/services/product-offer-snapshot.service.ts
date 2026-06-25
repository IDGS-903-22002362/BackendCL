import { FieldValue } from "firebase-admin/firestore";

import { firestoreTienda } from "../config/firebase";
import type { Oferta } from "../models/ofertas.model";
import type { Producto } from "../models/producto.model";
import { ofertasService } from "./ofertas.service";
import {
  ProductoOfertaBase,
  seleccionarMejorOferta,
} from "../utils/ofertas-pricing.util";

const PRODUCTOS_COLLECTION = "productos";
const SYNC_BATCH_SIZE = 200;

export interface ProductOfferSnapshotFields {
  tieneOfertaActiva: boolean;
  precioOferta: number | null;
  porcentajeDescuento: number;
  ofertaAplicadaId: string | null;
  ofertaTitulo: string | null;
}

export function computeProductOfferSnapshot(
  producto: ProductoOfertaBase,
  ofertasActivas: Oferta[],
): ProductOfferSnapshotFields {
  const precioOriginal = Math.max(0, Number(producto.precioPublico || 0));
  const mejorOferta = seleccionarMejorOferta(ofertasActivas, producto);

  if (!mejorOferta || precioOriginal <= 0) {
    return {
      tieneOfertaActiva: false,
      precioOferta: null,
      porcentajeDescuento: 0,
      ofertaAplicadaId: null,
      ofertaTitulo: null,
    };
  }

  const precioOferta = mejorOferta.precioFinal;
  const porcentajeDescuento =
    precioOferta < precioOriginal
      ? Math.round(((precioOriginal - precioOferta) / precioOriginal) * 100)
      : 0;

  if (porcentajeDescuento <= 0) {
    return {
      tieneOfertaActiva: false,
      precioOferta: null,
      porcentajeDescuento: 0,
      ofertaAplicadaId: null,
      ofertaTitulo: null,
    };
  }

  return {
    tieneOfertaActiva: true,
    precioOferta,
    porcentajeDescuento,
    ofertaAplicadaId: mejorOferta.oferta.id || null,
    ofertaTitulo: mejorOferta.oferta.titulo || "Oferta",
  };
}

export function readStoredOfferSnapshot(
  product: Producto,
): ProductOfferSnapshotFields | null {
  if (typeof product.tieneOfertaActiva !== "boolean") {
    return null;
  }

  return {
    tieneOfertaActiva: product.tieneOfertaActiva === true,
    precioOferta:
      typeof product.precioOferta === "number" ? product.precioOferta : null,
    porcentajeDescuento: Math.max(
      0,
      Math.floor(Number(product.porcentajeDescuento || 0)),
    ),
    ofertaAplicadaId:
      typeof product.ofertaAplicadaId === "string"
        ? product.ofertaAplicadaId
        : null,
    ofertaTitulo:
      typeof product.ofertaTitulo === "string" ? product.ofertaTitulo : null,
  };
}

export function toProductoOfertaBase(product: Producto): ProductoOfertaBase {
  return {
    id: product.id || "",
    precioPublico: Math.max(0, Number(product.precioPublico || 0)),
    categoriaId: product.categoriaId,
    lineaId: product.lineaId,
    tallaIds: product.tallaIds ?? [],
  };
}

class ProductOfferSnapshotService {
  private readonly productosCollection =
    firestoreTienda.collection(PRODUCTOS_COLLECTION);

  async syncProductOfferSnapshot(productId: string): Promise<void> {
    const doc = await this.productosCollection.doc(productId).get();
    if (!doc.exists) {
      return;
    }

    const product = { id: doc.id, ...(doc.data() as Producto) };
    const ofertasActivas = await ofertasService.listarOfertasActivas();
    const snapshot = computeProductOfferSnapshot(
      toProductoOfertaBase(product),
      ofertasActivas,
    );

    await doc.ref.update({
      ...snapshot,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async syncProductsByIds(productIds: string[]): Promise<number> {
    const uniqueIds = Array.from(new Set(productIds.map(String).filter(Boolean)));
    if (uniqueIds.length === 0) {
      return 0;
    }

    const ofertasActivas = await ofertasService.listarOfertasActivas();
    let updated = 0;

    for (let offset = 0; offset < uniqueIds.length; offset += SYNC_BATCH_SIZE) {
      const chunk = uniqueIds.slice(offset, offset + SYNC_BATCH_SIZE);
      const refs = chunk.map((id) => this.productosCollection.doc(id));
      const snapshots = await firestoreTienda.getAll(...refs);
      const batch = firestoreTienda.batch();
      let chunkUpdated = 0;

      snapshots.forEach((snapshot) => {
        if (!snapshot.exists) {
          return;
        }

        const product = {
          id: snapshot.id,
          ...(snapshot.data() as Producto),
        };
        const offerSnapshot = computeProductOfferSnapshot(
          toProductoOfertaBase(product),
          ofertasActivas,
        );

        batch.update(snapshot.ref, {
          ...offerSnapshot,
          updatedAt: FieldValue.serverTimestamp(),
        });
        chunkUpdated += 1;
      });

      if (chunkUpdated > 0) {
        await batch.commit();
        updated += chunkUpdated;
      }
    }

    return updated;
  }

  private async collectProductIdsForOffer(oferta: Oferta): Promise<string[]> {
    if (oferta.aplicaA === "productos") {
      return Array.isArray(oferta.productoIds)
        ? oferta.productoIds.filter(Boolean)
        : [];
    }

    if (oferta.aplicaA === "categorias") {
      const categoriaIds = oferta.categoriaIds ?? [];
      if (categoriaIds.length === 0) {
        return [];
      }

      const ids: string[] = [];
      for (const categoriaId of categoriaIds) {
        const snapshot = await this.productosCollection
          .where("activo", "==", true)
          .where("categoriaId", "==", categoriaId)
          .limit(SYNC_BATCH_SIZE)
          .get();
        snapshot.docs.forEach((doc) => ids.push(doc.id));
      }
      return ids;
    }

    if (oferta.aplicaA === "lineas") {
      const lineaIds = oferta.lineaIds ?? [];
      if (lineaIds.length === 0) {
        return [];
      }

      const ids: string[] = [];
      for (const lineaId of lineaIds) {
        const snapshot = await this.productosCollection
          .where("activo", "==", true)
          .where("lineaId", "==", lineaId)
          .limit(SYNC_BATCH_SIZE)
          .get();
        snapshot.docs.forEach((doc) => ids.push(doc.id));
      }
      return ids;
    }

    const snapshot = await this.productosCollection
      .where("activo", "==", true)
      .limit(500)
      .get();

    return snapshot.docs.map((doc) => doc.id);
  }

  async syncProductsAffectedByOffer(oferta: Oferta): Promise<number> {
    const productIds = await this.collectProductIdsForOffer(oferta);
    return this.syncProductsByIds(productIds);
  }

  async syncProductsAffectedByOffers(
    ofertaActual: Oferta,
    ofertaAnterior?: Oferta | null,
  ): Promise<number> {
    const productIds = new Set<string>();

    const currentIds = await this.collectProductIdsForOffer(ofertaActual);
    currentIds.forEach((id) => productIds.add(id));

    if (ofertaAnterior) {
      const previousIds = await this.collectProductIdsForOffer(ofertaAnterior);
      previousIds.forEach((id) => productIds.add(id));
    }

    return this.syncProductsByIds(Array.from(productIds));
  }

  async syncActiveOfferProductSnapshots(limit = 500): Promise<number> {
    const snapshot = await this.productosCollection
      .where("activo", "==", true)
      .where("tieneOfertaActiva", "==", true)
      .limit(limit)
      .get();

    return this.syncProductsByIds(snapshot.docs.map((doc) => doc.id));
  }

  async backfillAllActiveProducts(limit = 500): Promise<number> {
    const snapshot = await this.productosCollection
      .where("activo", "==", true)
      .limit(limit)
      .get();

    return this.syncProductsByIds(snapshot.docs.map((doc) => doc.id));
  }
}

export const productOfferSnapshotService = new ProductOfferSnapshotService();
export default productOfferSnapshotService;
