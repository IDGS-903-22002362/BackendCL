# 🧪 Guía de Pruebas - Gestión de Imágenes

Esta guía te ayudará a probar los endpoints de gestión de imágenes usando diferentes herramientas.

## 🚀 Preparación

1. **Asegúrate de que el servidor esté corriendo:**

```bash
npm run dev
```

2. **Verifica que hay productos en la BD:**

```bash
curl http://localhost:3000/api/productos
```

Si no hay productos, ejecuta:

```bash
npm run seed
```

## 🔧 Método 1: Postman (Recomendado)

### Subir Imagen

1. **Abre Postman**

2. **Crea una nueva petición:**

   - Método: `POST`
   - URL: `http://localhost:3000/api/productos/{ID_DEL_PRODUCTO}/imagenes`
   - Reemplaza `{ID_DEL_PRODUCTO}` con un ID real de tu base de datos

3. **Configura el Body:**

   - Selecciona la pestaña **Body**
   - Selecciona **form-data**
   - Agrega un campo:
     - Key: `imagenes` (⚠️ Importante: cambia el tipo a **File** usando el dropdown)
     - Value: Click en "Select Files" y elige una o varias imágenes

4. **Envía la petición** (botón "Send")

5. **Respuesta esperada:**

```json
{
  "success": true,
  "message": "1 imagen(es) subida(s) exitosamente",
  "data": {
    "urls": [
      "https://storage.googleapis.com/e-comerce-leon.appspot.com/productos/uuid.jpg"
    ],
    "totalImagenes": 1
  }
}
```

### Eliminar Imagen

1. **Crea otra petición:**

   - Método: `DELETE`
   - URL: `http://localhost:3000/api/productos/{ID_DEL_PRODUCTO}/imagenes`

2. **Configura el Body:**

   - Selecciona **raw**
   - Tipo: **JSON**
   - Contenido:

   ```json
   {
     "imageUrl": "https://storage.googleapis.com/e-comerce-leon.appspot.com/productos/uuid.jpg"
   }
   ```

   (Usa la URL que obtuviste al subir la imagen)

3. **Envía la petición**

---

## 💻 Método 2: cURL (Terminal)

### 1. Obtener un producto existente

```bash
curl http://localhost:3000/api/productos
```

Copia el `id` del primer producto de la respuesta.

### 2. Subir imagen

**Windows PowerShell:**

```powershell
$productId = "PEGA_EL_ID_AQUI"
$imagePath = "C:\ruta\a\tu\imagen.jpg"

curl -X POST "http://localhost:3000/api/productos/$productId/imagenes" -F "imagenes=@$imagePath"
```

**Linux/Mac:**

```bash
curl -X POST http://localhost:3000/api/productos/PRODUCTO_ID/imagenes \
  -F "imagenes=@/ruta/a/tu/imagen.jpg"
```

### 3. Eliminar imagen

**Windows PowerShell:**

```powershell
$productId = "PEGA_EL_ID_AQUI"
$imageUrl = "URL_DE_LA_IMAGEN"

$body = @{
  imageUrl = $imageUrl
} | ConvertTo-Json

curl -X DELETE "http://localhost:3000/api/productos/$productId/imagenes" `
  -H "Content-Type: application/json" `
  -d $body
```

**Linux/Mac:**

```bash
curl -X DELETE http://localhost:3000/api/productos/PRODUCTO_ID/imagenes \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://storage.googleapis.com/..."
  }'
```

---

## 🌐 Método 3: HTML + JavaScript (Navegador)

Crea un archivo `test.html`:

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Test Subida de Imágenes</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 600px;
        margin: 50px auto;
        padding: 20px;
      }
      input,
      button {
        margin: 10px 0;
        padding: 10px;
        width: 100%;
      }
      button {
        background: #4caf50;
        color: white;
        border: none;
        cursor: pointer;
        font-size: 16px;
      }
      button:hover {
        background: #45a049;
      }
      .result {
        background: #f0f0f0;
        padding: 15px;
        margin-top: 20px;
        border-radius: 5px;
        white-space: pre-wrap;
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <h1>🦁 Test Subida de Imágenes - Club León</h1>

    <h3>Subir Imagen</h3>
    <input type="text" id="productId" placeholder="ID del Producto" />
    <input type="file" id="fileInput" accept="image/*" multiple />
    <button onclick="uploadImages()">📤 Subir Imagen(es)</button>

    <div id="result" class="result" style="display:none;"></div>

    <script>
      const API_URL = "http://localhost:3000";

      async function uploadImages() {
        const productId = document.getElementById("productId").value;
        const fileInput = document.getElementById("fileInput");
        const resultDiv = document.getElementById("result");

        if (!productId) {
          alert("Por favor ingresa el ID del producto");
          return;
        }

        if (!fileInput.files.length) {
          alert("Por favor selecciona al menos una imagen");
          return;
        }

        // Crear FormData
        const formData = new FormData();
        for (let file of fileInput.files) {
          formData.append("imagenes", file);
        }

        try {
          resultDiv.textContent = "⏳ Subiendo imagen(es)...";
          resultDiv.style.display = "block";

          const response = await fetch(
            `${API_URL}/api/productos/${productId}/imagenes`,
            {
              method: "POST",
              body: formData,
            }
          );

          const result = await response.json();

          if (response.ok) {
            resultDiv.innerHTML = `
✅ ¡Éxito!

Imágenes subidas: ${result.data.urls.length}
Total de imágenes: ${result.data.totalImagenes}

URLs:
${result.data.urls.map((url, i) => `${i + 1}. ${url}`).join("\n")}
          `;
          } else {
            resultDiv.textContent = `❌ Error: ${result.message}`;
          }
        } catch (error) {
          resultDiv.textContent = `❌ Error: ${error.message}`;
        }
      }
    </script>
  </body>
</html>
```

**Uso:**

1. Guarda el archivo como `test.html`
2. Abre el archivo en tu navegador
3. Ingresa el ID de un producto existente
4. Selecciona una o varias imágenes
5. Click en "Subir Imagen(es)"

---

## 📋 Checklist de Pruebas

- [ ] Servidor corriendo en puerto 3000
- [ ] Base de datos poblada con datos de seed
- [ ] Obtener lista de productos y copiar un ID
- [ ] Subir una imagen JPG exitosamente
- [ ] Subir una imagen PNG exitosamente
- [ ] Subir múltiples imágenes (2-3) al mismo producto
- [ ] Verificar que las URLs son públicas (abrir en navegador)
- [ ] Consultar el producto y ver las URLs en el array `imagenes`
- [ ] Eliminar una imagen específica
- [ ] Verificar que la imagen ya no aparece en el array
- [ ] Intentar subir un archivo no-imagen (debe fallar)
- [ ] Intentar subir archivo > 5MB (debe fallar)

---

## ⚠️ Errores Comunes

### Error 400: "No se enviaron archivos"

- **Causa:** No se seleccionaron archivos en Postman
- **Solución:** Asegúrate de cambiar el tipo de campo a "File" en Postman

### Error 404: "Producto no encontrado"

- **Causa:** ID de producto incorrecto o producto no existe
- **Solución:** Verifica que el ID sea correcto ejecutando GET /api/productos

### Error 413: "Payload too large"

- **Causa:** Archivo demasiado grande (> 5MB)
- **Solución:** Comprime la imagen o usa una más pequeña

### Error 500: "Error al subir el archivo a Storage"

- **Causa:** Problema con configuración de Firebase Storage
- **Solución:** Verifica `.env` y que `FIREBASE_STORAGE_BUCKET` esté correcto

### CORS Error en navegador

- **Causa:** Petición desde origen diferente
- **Solución:** El servidor ya tiene CORS habilitado, asegúrate de estar usando el puerto correcto

---

## 🎯 Resultados Esperados

### Subir 1 imagen:

```json
{
  "success": true,
  "message": "1 imagen(es) subida(s) exitosamente",
  "data": {
    "urls": ["https://storage.googleapis.com/..."],
    "totalImagenes": 1
  }
}
```

### Subir 3 imágenes:

```json
{
  "success": true,
  "message": "3 imagen(es) subida(s) exitosamente",
  "data": {
    "urls": [
      "https://storage.googleapis.com/.../uuid1.jpg",
      "https://storage.googleapis.com/.../uuid2.png",
      "https://storage.googleapis.com/.../uuid3.jpg"
    ],
    "totalImagenes": 3
  }
}
```

### Eliminar imagen:

```json
{
  "success": true,
  "message": "Imagen eliminada exitosamente",
  "data": {
    "imagenesRestantes": 2
  }
}
```

---

## 🔍 Verificar en Firebase Console

1. Ve a Firebase Console → Storage
2. Navega a la carpeta `productos/`
3. Deberías ver los archivos con nombres UUID
4. Puedes descargar o ver las imágenes desde ahí

---

## 💡 Tips

- Las URLs generadas son **públicas** y permanentes
- Los archivos se nombran con UUID para evitar colisiones
- Se conserva la extensión original del archivo
- Puedes subir hasta 5 imágenes por petición
- Cada imagen puede pesar hasta 5MB
- Formatos soportados: JPG, PNG, GIF, WEBP, SVG

---

**¡Listo para probar!** 🚀
