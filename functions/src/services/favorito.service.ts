import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { Favorito, FavoritoConProducto } from "../models/favoritos.model";
import productService from "./product.service";

const FAVORITOS_COLLECTION = "favoritos";

export class FavoritoService {
  /**
   * Agrega un producto a favoritos de un usuario.
   * Si ya existe retorna el documento existente (no duplica).
   */
  async createFavorito(usuarioId: string, productoId: string): Promise<Favorito> {
    if (!usuarioId || !productoId) {
      throw new Error("usuarioId y productoId son requeridos");
    }

    // Verificar que el producto existe (opcional, pero buena práctica)
    const producto = await productService.getProductById(productoId);
    if (!producto) {
      throw new Error(`Producto con ID ${productoId} no encontrado`);
    }

    const now = admin.firestore.Timestamp.now();

    // Buscar si ya existe el favorito
    const existing = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .where("productoId", "==", productoId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      return {
        id: doc.id,
        usuarioId: doc.data().usuarioId,
        productoId: doc.data().productoId,
        createdAt: doc.data().createdAt,
      };
    }

    // Crear nuevo favorito
    const docRef = firestoreTienda.collection(FAVORITOS_COLLECTION).doc();
    const favorito: Omit<Favorito, "id"> = {
      usuarioId,
      productoId,
      createdAt: now,
    };

    await docRef.set(favorito);

    return {
      id: docRef.id,
      ...favorito,
    };
  }

  /**
   * Elimina un producto de favoritos.
   */
  async deleteFavorito(usuarioId: string, productoId: string): Promise<void> {
    const snapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .where("productoId", "==", productoId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new Error(`El producto ${productoId} no está en favoritos`);
    }

    await snapshot.docs[0].ref.delete();
  }

  /**
   * Lista favoritos de un usuario con datos del producto.
   */
  async getFavoritos(
    usuarioId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<FavoritoConProducto[]> {
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

    // Obtener todos los productos de una vez para evitar N+1
    const productoIds = favoritos.map((f) => f.productoId);
    const productosPromises = productoIds.map((id) =>
      productService.getProductById(id),
    );
    const productos = await Promise.all(productosPromises);
    const productoMap = new Map(
      productos.filter((p) => p !== null).map((p) => [p!.id, p]),
    );

    // Construir respuesta con datos populados
    return favoritos
      .map((fav) => {
        const producto = productoMap.get(fav.productoId);
        if (!producto) return null;
        return {
          id: fav.id,
          usuarioId: fav.usuarioId,
          createdAt: fav.createdAt,
          producto: {
            id: producto.id!,
            clave: producto.clave,
            descripcion: producto.descripcion,
            precioPublico: producto.precioPublico,
            imagenes: producto.imagenes.slice(0, 1), // solo primera imagen para mayor optimización
          },
        };
      })
      .filter((item): item is FavoritoConProducto => item !== null);
  }

  /**
   * Verifica si un producto está en favoritos de un usuario.
   * Retorna true si está, false si no.
   */
  async isFavorito(usuarioId: string, productoId: string): Promise<boolean> {
    const snapshot = await firestoreTienda
      .collection(FAVORITOS_COLLECTION)
      .where("usuarioId", "==", usuarioId)
      .where("productoId", "==", productoId)
      .limit(1)
      .get();

    return !snapshot.empty;
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