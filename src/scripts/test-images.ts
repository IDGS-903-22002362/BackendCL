/**
 * Script de Prueba: Subir Imagen a un Producto
 *
 * Este script demuestra cómo subir una imagen a un producto existente
 * usando el endpoint POST /api/productos/:id/imagenes
 */

import * as fs from "fs";

// Necesitas instalar: npm install form-data node-fetch@2
import FormData from "form-data";
import fetch from "node-fetch";

const API_URL = "http://localhost:3000";

/**
 * Función para subir imagen a un producto
 */
// @ts-ignore - Función usada en ejemplo comentado
async function uploadImageToProduct(productId: string, imagePath: string) {
  try {
    console.log("🚀 Iniciando subida de imagen...");
    console.log(`📦 Producto ID: ${productId}`);
    console.log(`📁 Archivo: ${imagePath}`);

    // Verificar que el archivo existe
    if (!fs.existsSync(imagePath)) {
      throw new Error(`El archivo no existe: ${imagePath}`);
    }

    // Crear FormData y agregar el archivo
    const form = new FormData();
    form.append("imagenes", fs.createReadStream(imagePath));

    // Hacer la petición
    console.log("\n⏳ Subiendo imagen...");
    const response = await fetch(
      `${API_URL}/api/productos/${productId}/imagenes`,
      {
        method: "POST",
        body: form,
      }
    );

    const result = await response.json();

    if (response.ok) {
      console.log("\n✅ ¡Imagen subida exitosamente!");
      console.log("\n📊 Resultado:");
      console.log(JSON.stringify(result, null, 2));
      return result.data.urls[0];
    } else {
      console.error("\n❌ Error al subir imagen:");
      console.error(JSON.stringify(result, null, 2));
      return null;
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
    return null;
  }
}

/**
 * Función para eliminar una imagen de un producto
 */
// @ts-ignore - Función usada en ejemplo comentado
async function deleteImageFromProduct(productId: string, imageUrl: string) {
  try {
    console.log("\n🗑️  Eliminando imagen...");
    console.log(`📦 Producto ID: ${productId}`);
    console.log(`🔗 URL: ${imageUrl}`);

    const response = await fetch(
      `${API_URL}/api/productos/${productId}/imagenes`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      console.log("\n✅ ¡Imagen eliminada exitosamente!");
      console.log("\n📊 Resultado:");
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error("\n❌ Error al eliminar imagen:");
      console.error(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
}

/**
 * Función principal
 */
async function main() {
  console.log("================================");
  console.log("  PRUEBA DE GESTIÓN DE IMÁGENES");
  console.log("================================\n");

  // 1. Primero necesitamos obtener un producto existente
  console.log("📋 Paso 1: Obtener lista de productos...\n");

  const productsResponse = await fetch(`${API_URL}/api/productos`);
  const productsData = await productsResponse.json();

  if (!productsData.success || productsData.data.length === 0) {
    console.error(
      "❌ No hay productos disponibles. Ejecuta 'npm run seed' primero."
    );
    return;
  }

  const primerProducto = productsData.data[0];
  console.log(`✅ Producto encontrado: ${primerProducto.descripcion}`);
  console.log(`   ID: ${primerProducto.id}`);
  console.log(
    `   Imágenes actuales: ${primerProducto.imagenes?.length || 0}\n`
  );

  // 2. Subir imagen (necesitas proporcionar una ruta válida)
  console.log("\n📤 Paso 2: Subir imagen...");
  console.log(
    "⚠️  Edita este script y proporciona una ruta válida de imagen\n"
  );

  // EJEMPLO: Descomentar y editar la ruta según tu sistema
  /*
  const rutaImagen = "C:\\Users\\tu_usuario\\Pictures\\producto.jpg";
  const imageUrl = await uploadImageToProduct(primerProducto.id, rutaImagen);
  
  if (imageUrl) {
    // 3. Esperar un momento
    console.log("\n⏳ Esperando 3 segundos...\n");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. Eliminar la imagen
    console.log("\n🗑️  Paso 3: Eliminar imagen...");
    await deleteImageFromProduct(primerProducto.id, imageUrl);
  }
  */

  console.log("\n================================");
  console.log("  FIN DE LA PRUEBA");
  console.log("================================\n");

  console.log("💡 Para probar con una imagen real:");
  console.log("   1. Edita este archivo (test-images.ts)");
  console.log("   2. Descomenta el código de subida de imagen");
  console.log("   3. Proporciona una ruta válida a una imagen");
  console.log("   4. Ejecuta: npx ts-node src/scripts/test-images.ts\n");
}

// Ejecutar
main().catch(console.error);

export {};
