/**
 * Modelo e interfaces para la entidad Noticias
 * Representa las noticias publicadas en la app
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Interface principal de Noticias
 * Representa un artículo en la colección 'noticias' de Firestore
 */
export interface Noticia {
    id?: string;

    // Contenido base
    titulo: string;
    descripcion: string;
    contenido: string;

    // Autor / origen
    usuarioId?: string;       // null si viene de red social
    autorNombre?: string;

    // Multimedia
    imagenes: string[];

    // Engagement
    likes?: number;

    // Redes sociales
    enlaceExterno?: string;
    origen?: "app" | "instagram" | "facebook" | "x" | "youtube";

    // IA
    ia?: NoticiaIA;

    // Estado
    estatus: boolean;

    // Auditoría
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface NoticiaIA {
    tituloIA?: string;
    resumenCorto?: string;
    resumenLargo?: string;
    generadoAt?: Timestamp;
}
/**
 * DTO para crear una nueva noticia.
 * Omite campos autogenerados como id, createdAt, updatedAt
 */
export interface CrearNoticiaDTO {
    titulo: string // Titulo de la noticia
    descripcion: string; // Nombre/descripción de la noticia
    usuarioId: string; // Referencia a documento en colección 'UsuariosApp'
    imagenes: string[]; // Array de URLs de imágenes de la noticia
    estatus: boolean; // Si la noticia está disponible.
}

/**
 * DTO para actualizar una noticia activa
 * Todos los campos son opcionales excepto los timestamps que se manejan automáticamente
 */
export interface ActualizarNoticiaDTO {
    titulo: string // Titulo de la noticia
    descripcion: string; // Nombre/descripción de la noticia
    imagenes: string[]; // Array de URLs de imágenes de la noticia
    estatus: boolean; // Si la noticia está disponible.
}

/**
 * Interface para noticia con información populada
 * Útil para respuestas de API que incluyan datos relacionados
 */
export interface NoticiaDetallado extends Noticia {
    usuario?: {
        nombre: string;
        email: string; // Correo electrónico
    };
}
