import { firestoreTienda } from "../../config/firebase";
import { CatalogProductCardDTO } from "../../models/product-catalog.model";
import { Producto } from "../../models/producto.model";
import { ofertasService } from "../ofertas.service";
import { seleccionarMejorOferta } from "../../utils/ofertas-pricing.util";
import {
  readStoredOfferSnapshot,
} from "../product-offer-snapshot.service";
import { isProductoElegible } from "./utils/product-eligibility.util";

const PRODUCTOS_COLLECTION = "productos";
const CATEGORIAS_COLLECTION = "categorias";
const LINEAS_COLLECTION = "lineas";

class ProductCardsService {
  private labelsCache: {
    expiresAt: number;
    categorias: Map<string, string>;
    lineas: Map<string, string>;
  } | null = null;

  private async loadLabels(): Promise<{
    categorias: Map<string, string>;
    lineas: Map<string, string>;
  }> {
    const now = Date.now();
    if (this.labelsCache && this.labelsCache.expiresAt > now) {
      return {
        categorias: this.labelsCache.categorias,
        lineas: this.labelsCache.lineas,
      };
    }

    const [categoriasSnap, lineasSnap] = await Promise.all([
      firestoreTienda.collection(CATEGORIAS_COLLECTION).get(),
      firestoreTienda.collection(LINEAS_COLLECTION).get(),
    ]);

    const categorias = new Map<string, string>();
    const lineas = new Map<string, string>();

    categoriasSnap.docs.forEach((doc) => {
      const data = doc.data() as { nombre?: string };
      categorias.set(doc.id, data.nombre || doc.id);
    });

    lineasSnap.docs.forEach((doc) => {
      const data = doc.data() as { nombre?: string };
      lineas.set(doc.id, data.nombre || doc.id);
    });

    this.labelsCache = {
      expiresAt: now + 5 * 60_000,
      categorias,
      lineas,
    };

    return { categorias, lineas };
  }

  private toCatalogCard(
    product: Producto,
    labels: { categorias: Map<string, string>; lineas: Map<string, string> },
    offer?: {
      precioFinal: number;
      ofertaId: string;
      ofertaTitulo: string;
      descuentoTotal: number;
      porcentajeDescuento: number;
    },
  ): CatalogProductCardDTO {
    const precioOriginal = Math.max(0, Number(product.precioPublico || 0));
    const stockTotal = Math.max(0, Math.floor(Number(product.existencias || 0)));

    return {
      id: product.id || "",
      slug: product.slug || product.id || "",
      nombre: product.descripcion || "",
      categoria: product.categoriaId || "",
      categoriaLabel:
        labels.categorias.get(product.categoriaId) || product.categoriaId || "",
      linea: product.lineaId || "",
      lineaLabel: labels.lineas.get(product.lineaId) || product.lineaId || "",
      precioOriginal,
      precioFinal: offer?.precioFinal ?? precioOriginal,
      tieneOferta: !!offer,
      ofertaAplicadaId: offer?.ofertaId ?? null,
      ofertaTitulo: offer?.ofertaTitulo ?? null,
      descuentoTotal: offer?.descuentoTotal ?? 0,
      porcentajeDescuento: offer?.porcentajeDescuento ?? 0,
      imagenPrincipal:
        Array.isArray(product.imagenes) && product.imagenes.length > 0
          ? product.imagenes[0]
          : null,
      imagenes: Array.isArray(product.imagenes)
        ? product.imagenes.filter(Boolean)
        : [],
      stockTotal,
      disponible:
        typeof product.disponible === "boolean"
          ? product.disponible
          : stockTotal > 0,
      destacado: product.destacado === true,
    };
  }

  async getProductsByIds(productIds: string[]): Promise<Map<string, Producto>> {
    const uniqueIds = Array.from(new Set(productIds.map(String).filter(Boolean)));
    const result = new Map<string, Producto>();

    if (uniqueIds.length === 0) {
      return result;
    }

    const refs = uniqueIds.map((id) =>
      firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id),
    );
    const snapshots = await firestoreTienda.getAll(...refs);

    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) {
        return;
      }

      result.set(snapshot.id, {
        id: snapshot.id,
        ...(snapshot.data() as Producto),
      });
    });

    return result;
  }

  async buildCatalogCards(
    productIds: string[],
    options?: { withOffers?: boolean },
  ): Promise<CatalogProductCardDTO[]> {
    const withOffers = options?.withOffers ?? true;
    const productsById = await this.getProductsByIds(productIds);
    const labels = await this.loadLabels();
    const ofertasActivas = withOffers
      ? await ofertasService.listarOfertasActivas()
      : [];

    const cards: CatalogProductCardDTO[] = [];

    for (const productId of productIds) {
      const product = productsById.get(productId);
      if (!isProductoElegible(product)) {
        continue;
      }

      let offer:
        | {
            precioFinal: number;
            ofertaId: string;
            ofertaTitulo: string;
            descuentoTotal: number;
            porcentajeDescuento: number;
          }
        | undefined;

      const precioOriginal = Math.max(0, Number(product!.precioPublico || 0));

      if (withOffers && product) {
        // Fuente de verdad: ofertas activas + precio ACTUAL (mismo criterio que
        // catálogo, ficha y checkout). Nunca usar el precioOferta congelado del
        // snapshot, que queda desfasado al cambiar el precio del producto.
        const mejorOferta = seleccionarMejorOferta(ofertasActivas, {
          id: product.id || productId,
          precioPublico: product.precioPublico,
          categoriaId: product.categoriaId,
          lineaId: product.lineaId,
          tallaIds: product.tallaIds ?? [],
        });

        if (
          mejorOferta &&
          mejorOferta.precioFinal > 0 &&
          mejorOferta.precioFinal < precioOriginal
        ) {
          const descuentoTotal = Math.max(
            0,
            precioOriginal - mejorOferta.precioFinal,
          );
          offer = {
            precioFinal: mejorOferta.precioFinal,
            ofertaId: mejorOferta.oferta.id || "",
            ofertaTitulo: mejorOferta.oferta.titulo || "Oferta",
            descuentoTotal,
            porcentajeDescuento:
              precioOriginal > 0
                ? Math.round((descuentoTotal / precioOriginal) * 100)
                : 0,
          };
        }
      } else {
        // Respaldo cuando no se cargan ofertas (withOffers=false): snapshot
        // denormalizado validado contra el precio actual.
        const storedOffer = readStoredOfferSnapshot(product!);

        if (
          storedOffer?.tieneOfertaActiva === true &&
          typeof storedOffer.precioOferta === "number" &&
          storedOffer.precioOferta > 0 &&
          storedOffer.precioOferta < precioOriginal
        ) {
          offer = {
            precioFinal: storedOffer.precioOferta,
            ofertaId: storedOffer.ofertaAplicadaId || "",
            ofertaTitulo: storedOffer.ofertaTitulo || "Oferta",
            descuentoTotal: Math.max(0, precioOriginal - storedOffer.precioOferta),
            porcentajeDescuento: storedOffer.porcentajeDescuento,
          };
        }
      }

      cards.push(this.toCatalogCard(product!, labels, offer));
    }

    return cards;
  }

  async listEligibleActiveProducts(limit = 200): Promise<Producto[]> {
    const snapshot = await firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .where("activo", "==", true)
      .where("disponible", "==", true)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Producto) }))
      .filter(isProductoElegible);
  }
}

export default new ProductCardsService();