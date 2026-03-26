import { Timestamp } from "firebase-admin/firestore";

/**
 * Interface para Favorito
 * Representa la relación usuario-producto en la colección 'favoritos'
 */
export interface Favorito {
  id?: string;            // ID del documento en Firestore
  usuarioId: string;      // uid del usuario (coincide con su documento en usuariosApp)
  productoId: string;     // ID del producto
  createdAt: Timestamp;   // Cuándo se agregó a favoritos
}

/**
 * DTO para crear un favorito (input del POST)
 */
export interface CrearFavoritoDTO {
  productoId: string;
}

/**
 * DTO para respuesta con datos del producto populados
 */
export interface FavoritoConProducto extends Omit<Favorito, 'productoId'> {
  producto: {
    id: string;
    clave: string;
    descripcion: string;
    precioPublico: number;
    imagenes: string[];
  };
}