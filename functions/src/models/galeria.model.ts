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

export type GaleriaMediaTipo = "imagen" | "video";

export interface GaleriaMediaMetadata {
    id: string;
    galeriaId: string;
    tipo: GaleriaMediaTipo;
    url: string;
    storagePath: string;
    contentType: string;
    size: number;
    nombreOriginal: string;
    width?: number;
    height?: number;
    duration?: number;
    orden?: number;
    estado: boolean;
    creadoEn: Date;
    actualizadoEn: Date;
}

export type CreateGaleriaMediaMetadata = Omit<
    GaleriaMediaMetadata,
    "id" | "galeriaId" | "estado" | "creadoEn" | "actualizadoEn"
>;
