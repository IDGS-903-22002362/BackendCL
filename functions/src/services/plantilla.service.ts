import { storageTienda } from "../config/firebase";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".avif",
]);

class PlantillaService {
  private bucket = storageTienda.bucket();

  /**
   * Obtiene las fotos de un jugador desde Firebase Storage
   * en la carpeta plantilla/{id}/
   */
  async getFotosPorId(id: string): Promise<Record<string, string[]>> {
    const idNormalizado = id.trim();
    const prefix = `plantilla/${idNormalizado}/`;

    const [files] = await this.bucket.getFiles({ prefix });

    const fotos = files
      .filter((file) => {
        if (file.name.endsWith("/")) {
          return false;
        }

        const extension = this.getFileExtension(file.name);
        return IMAGE_EXTENSIONS.has(extension);
      })
      .map(
        (file) =>
          `https://storage.googleapis.com/${this.bucket.name}/${encodeURI(file.name)}`,
      );

    return {
      [idNormalizado]: fotos,
    };
  }

  private getFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf(".");

    if (lastDotIndex === -1) {
      return "";
    }

    return fileName.slice(lastDotIndex).toLowerCase();
  }
}

export default new PlantillaService();
