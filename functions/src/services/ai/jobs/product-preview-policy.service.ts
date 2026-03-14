import { Producto } from "../../../models/producto.model";
import {
  ProductCategorySnapshot,
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
} from "../../../models/ai/ai.model";
import categoryService from "../../../services/category.service";
import lineService from "../../../services/line.service";

const BODY_TRYON_CATEGORY_IDS = new Set([
  "jersey",
  "playera",
  "sudadera",
  "chamarra",
]);
const ACCESSORY_MOCKUP_CATEGORY_IDS = new Set(["gorra", "calcetas"]);
const PROP_MOCKUP_CATEGORY_IDS = new Set(["balon", "accesorios"]);

const BODY_TRYON_KEYWORDS = [
  "jersey",
  "playera",
  "camiseta",
  "sudadera",
  "hoodie",
  "chamarra",
];
const ACCESSORY_KEYWORDS = ["gorra", "cachucha", "beanie", "calceta", "calcetin"];
const PROP_KEYWORDS = [
  "balon",
  "accesorio",
  "souvenir",
  "bufanda",
  "llavero",
  "bandera",
  "termo",
  "taza",
  "mochila",
];

export interface ResolvedProductPreviewPolicy {
  previewMode: ProductPreviewMode;
  productPreviewType: ProductPreviewType;
  classificationSource: ProductPreviewClassificationSource;
  productCategorySnapshot: ProductCategorySnapshot;
}

const normalizeToken = (value: string | undefined | null): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const hasKeyword = (normalizedText: string, keywords: string[]): boolean =>
  keywords.some((keyword) => normalizedText.includes(keyword));

const buildUnsupportedPolicy = (
  snapshot: ProductCategorySnapshot,
  classificationSource = ProductPreviewClassificationSource.UNCLASSIFIED,
): ResolvedProductPreviewPolicy => ({
  previewMode: ProductPreviewMode.UNSUPPORTED,
  productPreviewType: ProductPreviewType.UNKNOWN,
  classificationSource,
  productCategorySnapshot: snapshot,
});

const buildPolicy = (
  previewMode: ProductPreviewMode,
  productPreviewType: ProductPreviewType,
  classificationSource: ProductPreviewClassificationSource,
  snapshot: ProductCategorySnapshot,
): ResolvedProductPreviewPolicy => ({
  previewMode,
  productPreviewType,
  classificationSource,
  productCategorySnapshot: snapshot,
});

class ProductPreviewPolicyService {
  async resolvePolicy(product: Producto): Promise<ResolvedProductPreviewPolicy> {
    const [category, line] = await Promise.all([
      categoryService.getCategoryById(product.categoriaId),
      lineService.getLineById(product.lineaId),
    ]);

    const snapshot: ProductCategorySnapshot = {
      categoryId: product.categoriaId,
      categoryName: category?.nombre || null,
      lineId: product.lineaId,
      lineName: line?.nombre || null,
      productDescription: product.descripcion,
    };

    const normalizedCategoryId = normalizeToken(product.categoriaId);
    if (BODY_TRYON_CATEGORY_IDS.has(normalizedCategoryId)) {
      return buildPolicy(
        ProductPreviewMode.BODY_TRYON,
        ProductPreviewType.APPAREL,
        ProductPreviewClassificationSource.CATEGORY_ID,
        snapshot,
      );
    }

    if (ACCESSORY_MOCKUP_CATEGORY_IDS.has(normalizedCategoryId)) {
      return buildPolicy(
        ProductPreviewMode.ACCESSORY_MOCKUP,
        ProductPreviewType.ACCESSORY,
        ProductPreviewClassificationSource.CATEGORY_ID,
        snapshot,
      );
    }

    if (PROP_MOCKUP_CATEGORY_IDS.has(normalizedCategoryId)) {
      return buildPolicy(
        ProductPreviewMode.PROP_MOCKUP,
        ProductPreviewType.PROP,
        ProductPreviewClassificationSource.CATEGORY_ID,
        snapshot,
      );
    }

    const normalizedCategoryName = normalizeToken(category?.nombre);
    if (hasKeyword(normalizedCategoryName, BODY_TRYON_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.BODY_TRYON,
        ProductPreviewType.APPAREL,
        ProductPreviewClassificationSource.CATEGORY_NAME,
        snapshot,
      );
    }

    if (hasKeyword(normalizedCategoryName, ACCESSORY_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.ACCESSORY_MOCKUP,
        ProductPreviewType.ACCESSORY,
        ProductPreviewClassificationSource.CATEGORY_NAME,
        snapshot,
      );
    }

    if (hasKeyword(normalizedCategoryName, PROP_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.PROP_MOCKUP,
        ProductPreviewType.PROP,
        ProductPreviewClassificationSource.CATEGORY_NAME,
        snapshot,
      );
    }

    const normalizedLineName = normalizeToken(line?.nombre);
    if (normalizedLineName === "souvenir") {
      return buildPolicy(
        ProductPreviewMode.PROP_MOCKUP,
        ProductPreviewType.PROP,
        ProductPreviewClassificationSource.LINE_NAME,
        snapshot,
      );
    }

    const normalizedDescription = normalizeToken(product.descripcion);
    if (hasKeyword(normalizedDescription, BODY_TRYON_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.BODY_TRYON,
        ProductPreviewType.APPAREL,
        ProductPreviewClassificationSource.DESCRIPTION_KEYWORD,
        snapshot,
      );
    }

    if (hasKeyword(normalizedDescription, ACCESSORY_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.ACCESSORY_MOCKUP,
        ProductPreviewType.ACCESSORY,
        ProductPreviewClassificationSource.DESCRIPTION_KEYWORD,
        snapshot,
      );
    }

    if (hasKeyword(normalizedDescription, PROP_KEYWORDS)) {
      return buildPolicy(
        ProductPreviewMode.PROP_MOCKUP,
        ProductPreviewType.PROP,
        ProductPreviewClassificationSource.DESCRIPTION_KEYWORD,
        snapshot,
      );
    }

    return buildUnsupportedPolicy(snapshot);
  }
}

export const productPreviewPolicyService = new ProductPreviewPolicyService();
export default productPreviewPolicyService;
