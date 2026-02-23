export interface CrearNoticiaDTO {
    titulo: string;
    descripcion: string;
    contenido: string;
    imagenes?: string[];
}

export interface ActualizarNoticiaDTO {
    titulo?: string;
    descripcion?: string;
    contenido?: string;
    imagenes?: string[];
    estatus?: boolean;
}