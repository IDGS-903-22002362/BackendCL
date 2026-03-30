import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { Favorito, FavoritoConProducto } from "../models/favoritos.model";
import { Producto } from "../models/producto.model";
import logger from "../utils/logger";
import productService from "./product.service";

const FAVORITOS_COLLECTION = "favoritos";
const favoritoLogger = logger.child({ component: "favorito-service" });

type FavoriteCreationResult = {
  favorito: Favorito;
  created: boolean;
};

export class FavoritoServiceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ARGUMENT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "FavoritoServiceError";
  }
}

export class FavoritoService {
  private buildFavoriteDocId(usuarioId: string, productoId: string): string {
    return `${encodeURIComponent(usuarioId)}__${encodeURIComponent(productoId)}`;
  }

  private ensureEligibleProduct(
    producto: Producto | null,
    productoId: string,
  ): Producto {
    if (!producto) {
      throw new FavoritoServiceError(
        "NOT_FOUND",
        `Producto con ID ${productoId} no encontrado`,
      );
    }

    if (!producto.activo) {
      throw new FavoritoServiceError(
        "CONFLICT",
        `Producto con ID ${productoId} está inactivo y no puede agregarse a favoritos`,
      );
    }

    return producto;
  }

  private async findLegacyFavorite(
    usuarioId: string,
    productoId: string,
  ): Promise<Favorito | null> {
    const snapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .where("productoId", "==", productoId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      usuarioId: doc.data().usuarioId,
      productoId: doc.data().productoId,
      createdAt: doc.data().createdAt,
    };
  }

  private buildFavoritoConProducto(
    favorito: Favorito,
    producto: Producto,
  ): FavoritoConProducto {
    return {
      id: favorito.id,
      usuarioId: favorito.usuarioId,
      createdAt: favorito.createdAt,
      producto: {
        id: producto.id ?? favorito.productoId,
        clave: producto.clave,
        descripcion: producto.descripcion,
        precioPublico: producto.precioPublico,
        imagenes: producto.imagenes.slice(0, 1),
      },
    };
  }

  /**
   * Agrega un producto a favoritos de un usuario.
   * Si ya existe retorna el documento existente (no duplica).
   */
  async createFavorito(
    usuarioId: string,
    productoId: string,
  ): Promise<FavoriteCreationResult> {
    if (!usuarioId || !productoId) {
      throw new FavoritoServiceError(
        "INVALID_ARGUMENT",
        "usuarioId y productoId son requeridos",
      );
    }

    const producto = await productService.getProductById(productoId);
    this.ensureEligibleProduct(producto, productoId);

    const existingLegacyFavorite = await this.findLegacyFavorite(usuarioId, productoId);
    if (existingLegacyFavorite) {
      return {
        favorito: existingLegacyFavorite,
        created: false,
      };
    }

    const now = admin.firestore.Timestamp.now();
    const favoritoId = this.buildFavoriteDocId(usuarioId, productoId);
    const favoritoRef = firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .doc(favoritoId);

    try {
      return await firestoreTienda.runTransaction(async (transaction) => {
        const existingDoc = await transaction.get(favoritoRef);
        if (existingDoc.exists) {
          const data = existingDoc.data();
          return {
            favorito: {
              id: existingDoc.id,
              usuarioId: String(data?.usuarioId ?? usuarioId),
              productoId: String(data?.productoId ?? productoId),
              createdAt: data?.createdAt ?? now,
            },
            created: false,
          };
        }

        const favorito: Omit<Favorito, "id"> = {
          usuarioId,
          productoId,
          createdAt: now,
        };

        transaction.set(favoritoRef, favorito);

        return {
          favorito: {
            id: favoritoRef.id,
            ...favorito,
          },
          created: true,
        };
      });
    } catch (error) {
      favoritoLogger.error("favorito_create_failed", {
        usuarioId,
        productoId,
        error:
          error instanceof Error ? error.message : "unknown_favorito_create_error",
      });
      if (error instanceof FavoritoServiceError) {
        throw error;
      }

      throw new FavoritoServiceError(
        "INTERNAL",
        "Error al agregar favorito",
      );
    }
  }

  /**
   * Elimina un producto de favoritos.
   */
  async deleteFavorito(usuarioId: string, productoId: string): Promise<void> {
    if (!usuarioId || !productoId) {
      throw new FavoritoServiceError(
        "INVALID_ARGUMENT",
        "usuarioId y productoId son requeridos",
      );
    }

    const favoritoId = this.buildFavoriteDocId(usuarioId, productoId);
    const favoritoRef = firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .doc(favoritoId);
    const deterministicSnapshot = await favoritoRef.get();

    if (deterministicSnapshot.exists) {
      await deterministicSnapshot.ref.delete();
      return;
    }

    const legacyFavorite = await this.findLegacyFavorite(usuarioId, productoId);
    if (!legacyFavorite) {
      throw new FavoritoServiceError(
        "NOT_FOUND",
        `El producto ${productoId} no está en favoritos`,
      );
    }

    await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .doc(legacyFavorite.id)
      .delete();
  }

  /**
   * Lista favoritos de un usuario con datos del producto.
   */
  async getFavoritos(
    usuarioId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<FavoritoConProducto[]> {
    if (!usuarioId) {
      throw new FavoritoServiceError(
        "INVALID_ARGUMENT",
        "usuarioId es requerido",
      );
    }

    const snapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(limit)
      .get();

    if (snapshot.empty) {
      return [];
    }

    const favoritos = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Favorito[];

    const productoIds = favoritos.map((f) => f.productoId);
    const productos = await Promise.all(
      productoIds.map(async (id) => {
        const producto = await productService.getProductById(id);
        return producto?.activo ? producto : null;
      }),
    );
    const productoMap = new Map<string, Producto>();
    for (const producto of productos) {
      if (producto?.id) {
        productoMap.set(producto.id, producto);
      }
    }

    return favoritos.reduce<FavoritoConProducto[]>((acc, favorito) => {
      const producto = productoMap.get(favorito.productoId);
      if (!producto) {
        return acc;
      }

      acc.push(this.buildFavoritoConProducto(favorito, producto));
      return acc;
    }, []);
  }

  /**
   * Verifica si un producto está en favoritos de un usuario.
   * Retorna true si está, false si no.
   */
  async isFavorito(usuarioId: string, productoId: string): Promise<boolean> {
    if (!usuarioId || !productoId) {
      throw new FavoritoServiceError(
        "INVALID_ARGUMENT",
        "usuarioId y productoId son requeridos",
      );
    }

    const favoritoId = this.buildFavoriteDocId(usuarioId, productoId);
    const deterministicSnapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .doc(favoritoId)
      .get();

    if (deterministicSnapshot.exists) {
      return true;
    }

    const legacyFavorite = await this.findLegacyFavorite(usuarioId, productoId);
    return legacyFavorite !== null;
  }

  /**
   * Obtiene los IDs de todos los productos favoritos de un usuario.
   */
  async getFavoritoProductIds(usuarioId: string): Promise<string[]> {
    const snapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .select("productoId")
      .get();

    return snapshot.docs.map((doc) => doc.data().productoId);
  }
}

export default new FavoritoService();
