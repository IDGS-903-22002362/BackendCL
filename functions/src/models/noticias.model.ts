export type OrigenNoticia = "app" | "instagram" | "facebook" | "x" | "youtube";
export type CategoriaNoticia = "femenil" | "varonil";

export interface Noticia {
    id: string;
    titulo: string;
    descripcion: string;
    contenido: string;
    imagenes: string[];
    origen: OrigenNoticia;
    categoria: CategoriaNoticia;
    usuarioId?: string;
    autorNombre?: string;
    estatus: boolean;
    likes: number;
    createdAt: Date;
    updatedAt: Date;
    ia?: string;
}