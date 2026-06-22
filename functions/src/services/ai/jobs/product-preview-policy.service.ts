import { Producto } from "../../../models/producto.model";
import {
  ProductCategorySnapshot,
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
} from "../../../models/ai/ai.model";
import categoryService from "../../../services/category.service";
import lineService from "../../../services/line.service";

const ADULT_LINE_IDS = new Set(["caballero", "dama", "viejito"]);
const NON_ADULT_LINE_IDS = new Set([
  "bebe",
  "infantil",
  "adolescente",
  "juvenil",
  "nino",
  "nina",
  "kids",
  "baby",
]);

const APPAREL_CATEGORY_IDS = new Set([
  "jersey",
  "playera",
  "sudadera",
  "chamarra",
  "pantalon",
  "short",
]);

const EXCLUDED_CATEGORY_IDS = new Set([
  "gorra",
  "calcetas",
  "balon",
  "accesorios",
]);

const ADULT_LINE_KEYWORDS = [
  "caballero",
  "dama",
  "viejito",
  "viejita",
  "adulto",
  "adulta",
  "hombre",
  "mujer",
];
const NON_ADULT_LINE_KEYWORDS = [
  "bebe",
  "baby",
  "infantil",
  "adolescente",
  "juvenil",
  "nino",
  "nina",
  "kids",
  "kid",
];
const APPAREL_KEYWORDS = [
  "jersey",
  "playera",
  "camiseta",
  "sudadera",
  "hoodie",
  "chamarra",
  "pantalon",
  "short",
  "prenda",
];
const EXCLUDED_CATEGORY_KEYWORDS = [
  "gorra",
  "cachucha",
  "beanie",
  "calceta",
  "calcetin",
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

const resolveLineEligibility = (
  lineId: string,
  lineName: string,
): "adult" | "non_adult" | "unknown" => {
  if (NON_ADULT_LINE_IDS.has(lineId) || hasKeyword(lineName, NON_ADULT_LINE_KEYWORDS)) {
    return "non_adult";
  }

  if (ADULT_LINE_IDS.has(lineId) || hasKeyword(lineName, ADULT_LINE_KEYWORDS)) {
    return "adult";
  }

  return "unknown";
};

const resolveCategoryEligibility = (
  categoryId: string,
  categoryName: string,
): "apparel" | "excluded" | "unknown" => {
  if (EXCLUDED_CATEGORY_IDS.has(categoryId) || hasKeyword(categoryName, EXCLUDED_CATEGORY_KEYWORDS)) {
    return "excluded";
  }

  if (APPAREL_CATEGORY_IDS.has(categoryId) || hasKeyword(categoryName, APPAREL_KEYWORDS)) {
    return "apparel";
  }

  return "unknown";
};

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

    const normalizedLineId = normalizeToken(product.lineaId);
    const normalizedLineName = normalizeToken(line?.nombre);
    const normalizedCategoryId = normalizeToken(product.categoriaId);
    const normalizedCategoryName = normalizeToken(category?.nombre);
    const normalizedDescription = normalizeToken(product.descripcion);

    const lineEligibility = resolveLineEligibility(normalizedLineId, normalizedLineName);
    if (lineEligibility === "non_adult") {
      return buildUnsupportedPolicy(
        snapshot,
        ProductPreviewClassificationSource.LINE_NAME,
      );
    }

    const categoryEligibility = resolveCategoryEligibility(
      normalizedCategoryId,
      normalizedCategoryName,
    );
    if (categoryEligibility === "excluded") {
      return buildUnsupportedPolicy(
        snapshot,
        ProductPreviewClassificationSource.CATEGORY_ID,
      );
    }

    if (
      lineEligibility === "adult" &&
      (categoryEligibility === "apparel" ||
        hasKeyword(normalizedDescription, APPAREL_KEYWORDS))
    ) {
      const classificationSource =
        categoryEligibility === "apparel"
          ? APPAREL_CATEGORY_IDS.has(normalizedCategoryId)
            ? ProductPreviewClassificationSource.CATEGORY_ID
            : ProductPreviewClassificationSource.CATEGORY_NAME
          : ProductPreviewClassificationSource.DESCRIPTION_KEYWORD;

      return buildPolicy(
        ProductPreviewMode.BODY_TRYON,
        ProductPreviewType.APPAREL,
        classificationSource,
        snapshot,
      );
    }

    if (hasKeyword(normalizedDescription, EXCLUDED_CATEGORY_KEYWORDS)) {
      return buildUnsupportedPolicy(
        snapshot,
        ProductPreviewClassificationSource.DESCRIPTION_KEYWORD,
      );
    }

    return buildUnsupportedPolicy(snapshot);
  }
}

export const productPreviewPolicyService = new ProductPreviewPolicyService();
export default productPreviewPolicyService;
