export interface Galeria {
    id: string;
    descripcion: string;
    imagenes: string[];
    videos: string[];
    usuarioId?: string;
    autorNombre?: string;
    estatus: boolean;
    createdAt: Date;
    updatedAt: Date;
}