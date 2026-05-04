import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { Banner, BannerContentConfig, CreateBannerDTO, UpdateBannerDTO } from "../models/banner.model";
import { Producto } from "../models/producto.model";
import productService from "./product.service";

const BANNERS_COLLECTION = "banners";

class BannerService {
    private normalizeBanner(doc: FirebaseFirestore.DocumentSnapshot): Banner | null {
        if (!doc.exists) return null;
        const data = doc.data()!;
        return {
            id: doc.id,
            title: data.title,
            subtitle: data.subtitle,
            backgroundImage: data.backgroundImage,
            videoUrl: data.videoUrl,
            buttons: data.buttons || [],
            contentConfig: data.contentConfig || {},
            active: data.active,
            order: data.order,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
        } as Banner;
    }
    private async getMaxOrder(): Promise<number> {
        const snapshot = await firestoreTienda
            .collection(BANNERS_COLLECTION)
            .orderBy("order", "desc")
            .limit(1)
            .get();
        if (snapshot.empty) return 0;
        return snapshot.docs[0].data().order || 0;
    }

    async getAllBanners(): Promise<Banner[]> {
        const snapshot = await firestoreTienda
            .collection(BANNERS_COLLECTION)
            .orderBy("order", "asc")
            .get();
        return snapshot.docs.map(doc => this.normalizeBanner(doc)!);
    }

    async getActiveBanners(): Promise<Banner[]> {
        const snapshot = await firestoreTienda
            .collection(BANNERS_COLLECTION)
            .where("active", "==", true)
            .orderBy("order", "asc")
            .get();
        return snapshot.docs.map(doc => this.normalizeBanner(doc)!);
    }

    async getBannerById(id: string): Promise<Banner | null> {
        const doc = await firestoreTienda.collection(BANNERS_COLLECTION).doc(id).get();
        return this.normalizeBanner(doc);
    }

    async createBanner(data: CreateBannerDTO): Promise<Banner> {
        const now = admin.firestore.Timestamp.now();
        // Si no se proporciona order, asignar el máximo+1 (opcional)
        let order = data.order;
        if (order === undefined) {
            const maxOrder = await this.getMaxOrder();
            order = maxOrder + 1;
        }
        const docRef = await firestoreTienda.collection(BANNERS_COLLECTION).add({
            ...data,
            order,
            createdAt: now,
            updatedAt: now,
        });
        const newBanner = await this.getBannerById(docRef.id);
        if (!newBanner) throw new Error("Error al crear banner");
        return newBanner;
    }

    async updateBanner(id: string, data: UpdateBannerDTO): Promise<Banner> {
        const docRef = firestoreTienda.collection(BANNERS_COLLECTION).doc(id);
        const existing = await this.getBannerById(id);
        if (!existing) throw new Error(`Banner con ID ${id} no encontrado`);

        const now = admin.firestore.Timestamp.now();
        const updatePayload: any = { ...data, updatedAt: now };

        await docRef.update(updatePayload);
        const updated = await this.getBannerById(id);
        if (!updated) throw new Error("Error al actualizar banner");
        return updated;
    }

    async deleteBanner(id: string): Promise<void> {
        const docRef = firestoreTienda.collection(BANNERS_COLLECTION).doc(id);
        await docRef.update({ active: false, updatedAt: admin.firestore.Timestamp.now() });
    }



    async resolveProductsForBanner(config: BannerContentConfig): Promise<Producto[]> {
        const {
            type,
            categoriaId,
            lineaId,
            tallaId,
            productIds,
            limit = 10,
            sortBy = "createdAt",
            sortOrder = "desc"
        } = config;

        let productos: Producto[] = [];

        switch (type) {
            case "categoria":
                if (!categoriaId) throw new Error("Se requiere categoriaId para tipo categoria");
                productos = await productService.getProductsByCategory(categoriaId);
                break;

            case "linea":
                if (!lineaId) throw new Error("Se requiere lineaId para tipo linea");
                productos = await productService.getProductsByLine(lineaId);
                break;

            case "talla":
                if (!tallaId) throw new Error("Se requiere tallaId para tipo talla");
                const allProducts = await productService.getAllProducts();
                productos = allProducts.filter(p => p.tallaIds?.includes(tallaId));
                break;

            case "productos":
                if (!productIds?.length) throw new Error("Se requiere productIds para tipo productos");
                const fetched = await Promise.all(productIds.map(pid => productService.getProductById(pid)));
                productos = fetched.filter(p => p !== null) as Producto[];
                break;

            case "novedades":
                productos = await productService.getAllProducts();
                break;

            case "mas_vendidos":
                // Si tienes un servicio de analytics o un campo 'ventas' en producto
                productos = await productService.getAllProducts();
                // Ordenar por ventas (mock: por ahora solo ordenar por existencias invertido)
                productos.sort((a, b) => (b.existencias || 0) - (a.existencias || 0));
                break;

            default:
                productos = await productService.getAllProducts();
        }

        // Ordenar
        const sortKey = sortBy === "createdAt" ? "createdAt" : sortBy === "precioPublico" ? "precioPublico" : "createdAt";
        productos.sort((a, b) => {
            let aVal: any = a[sortKey];
            let bVal: any = b[sortKey];
            if (sortKey === "createdAt") {
                aVal = a.createdAt?.toDate?.()?.getTime() || 0;
                bVal = b.createdAt?.toDate?.()?.getTime() || 0;
            }
            if (sortOrder === "asc") return aVal > bVal ? 1 : -1;
            return aVal < bVal ? 1 : -1;
        });

        return productos.slice(0, limit);
    }

    // Método para obtener banners activos con productos ya resueltos
    async getActiveBannersWithResolvedProducts(): Promise<Array<{ banner: Banner; products: Producto[] }>> {
        const banners = await this.getActiveBanners();
        const results = await Promise.all(
            banners.map(async (banner) => {
                const products = await this.resolveProductsForBanner(banner.contentConfig);
                return { banner, products };
            })
        );
        return results;
    }

    async getBannerWithResolvedProducts(id: string): Promise<{ banner: Banner; products: Producto[] } | null> {
        const banner = await this.getBannerById(id);
        if (!banner) return null;
        const products = await this.resolveProductsForBanner(banner.contentConfig);
        return { banner, products };
    }
}

export default new BannerService();