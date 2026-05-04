import { Timestamp } from "firebase-admin/firestore";

export interface BannerButton {
    text: string;
    url: string;
}

export type BannerContentType =
    | "categoria"      // Productos de una categoría específica
    | "linea"          // Productos de una línea específica
    | "talla"          // Productos que tienen una talla específica
    | "productos"      // Lista explícita de IDs de productos
    | "oferta"         // Productos en oferta (con descuento)
    | "novedades"      // Productos más recientes
    | "mas_vendidos";  // Productos con más ventas (requiere analytics)

export interface BannerContentConfig {
    type: BannerContentType;
    // Según el tipo, se usan estos campos (opcionales según el caso)
    categoriaId?: string;
    lineaId?: string;
    tallaId?: string;
    productIds?: string[];
    limit?: number;        // Máximo de productos a mostrar (default 10)
    sortBy?: "createdAt" | "precioPublico" | "mas_vendidos";
    sortOrder?: "asc" | "desc";
    minDiscount?: number;  // Para ofertas: descuento mínimo porcentual
}

export interface Banner {
    id?: string;
    title: string;
    subtitle?: string;
    backgroundImage: string;       // URL de Firebase Storage
    videoUrl?: string;             // Puede ser YouTube, Vimeo o archivo subido
    buttons: BannerButton[];
    contentConfig: BannerContentConfig;
    active: boolean;               // Solo un banner puede estar activo a la vez
    order?: number;                // Por si quieres múltiples banners en carrusel
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface CreateBannerDTO {
    title: string;
    subtitle?: string;
    backgroundImage: string;
    videoUrl?: string;
    buttons: BannerButton[];
    productIds: string[];
    active: boolean;
    order?: number;
}

export interface UpdateBannerDTO extends Partial<CreateBannerDTO> { }