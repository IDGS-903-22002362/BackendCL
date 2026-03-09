import { CategoriaNoticia } from "./noticias.model";

export interface CrearNoticiaDTO {
    titulo: string;
    descripcion: string;
    contenido: string;
    imagenes?: string[];
    categoria: CategoriaNoticia;

}

export interface ActualizarNoticiaDTO {
    titulo?: string;
    descripcion?: string;
    contenido?: string;
    imagenes?: string[];
    estatus?: boolean;
    categoria?: CategoriaNoticia;
}