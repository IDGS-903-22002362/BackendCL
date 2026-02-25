import axios from "axios";

const BEHOLD_URL = "https://feeds.behold.so/NzIdedricsSrXPcg3VKG";

class InstagramService {
    async obtenerPublicaciones() {
        try {
            const response = await axios.get(BEHOLD_URL);
            const posts = response.data.posts || [];

            // Retornamos los posts ya mapeados al formato de tu DB
            return posts.map((post: any) => {
                const noticiaId = `ig_${post.id}`;

                // Lógica de imágenes centralizada
                let listaImagenes: string[] = [];
                if (post.mediaType === "CAROUSEL_ALBUM" && Array.isArray(post.children)) {
                    listaImagenes = post.children.map((child: any) => String(child.mediaUrl));
                } else {
                    const urlPrincipal = post.mediaUrl || post.thumbnailUrl;
                    if (urlPrincipal) listaImagenes.push(String(urlPrincipal));
                }

                return {
                    id: noticiaId,
                    titulo: post.caption?.split('\n')[0].slice(0, 80) || "Publicación de Instagram",
                    descripcion: "Instagram",
                    contenido: post.caption || "",
                    tipo: String(post.mediaType || "IMAGE"),
                    esReel: post.isReel === true,
                    imagenes: listaImagenes,
                    videoUrl: post.mediaType === "VIDEO" ? (post.mediaUrl || "") : "",
                    thumbnail: post.thumbnailUrl || post.mediaUrl || "",
                    enlaceExterno: post.permalink || "",
                    origen: "instagram",
                    estatus: true,
                    // Forzamos String para evitar el objeto Timestamp de Firebase
                    createdAt: String(post.timestamp),
                    updatedAt: new Date().toISOString(),
                    ia: null
                };
            });
        } catch (error: any) {
            console.error("Behold API ERROR:", error.message);
            return [];
        }
    }
}

export default new InstagramService();