export type OrigenNoticia = "app" | "instagram" | "facebook" | "x" | "youtube";

export interface Noticia {
    id: string;
    titulo: string;
    descripcion: string;
    contenido: string;
    imagenes: string[];
    origen: OrigenNoticia;
    usuarioId?: string;
    autorNombre?: string;
    estatus: boolean;
    createdAt: Date;
    updatedAt: Date;
}