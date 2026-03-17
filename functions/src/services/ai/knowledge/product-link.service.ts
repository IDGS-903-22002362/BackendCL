import aiConfig from "../../../config/ai.config";

type LinkableProduct = {
  id?: string;
  slug?: unknown;
  [key: string]: unknown;
};

const normalizeSegment = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

class ProductLinkService {
  buildProductLink(product: LinkableProduct | string): string | null {
    const { baseUrl, productPathTemplate } = aiConfig.storefront;
    if (!baseUrl) {
      return null;
    }

    const normalizedProduct =
      typeof product === "string"
        ? { id: product }
        : product;

    const id = normalizeSegment(normalizedProduct.id);
    const slug = normalizeSegment(normalizedProduct.slug);
    const canonicalSegment = slug || id;

    if (!canonicalSegment) {
      return null;
    }

    const path = productPathTemplate
      .replace(":slug", encodeURIComponent(canonicalSegment))
      .replace(":id", encodeURIComponent(canonicalSegment));

    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

export const productLinkService = new ProductLinkService();
export default productLinkService;
