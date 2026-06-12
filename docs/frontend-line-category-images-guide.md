# Guia frontend: imagen principal en lineas y categorias

Ultima actualizacion: 2026-06-12

Esta guia explica como consumir los cambios nuevos para mostrar y administrar una imagen principal en lineas y categorias de productos.

## 1. Que cambio

Los recursos de lineas y categorias ahora pueden incluir:

```ts
imagenPrincipal: string | null;
```

El campo es opcional al crear/actualizar y puede venir como `null` en registros antiguos o cuando aun no se ha cargado imagen.

## 2. Tipos recomendados

```ts
export type Linea = {
  id: string;
  codigo: number;
  nombre: string;
  imagenPrincipal: string | null;
  activo?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Categoria = {
  id: string;
  nombre: string;
  imagenPrincipal: string | null;
  lineaId?: string | null;
  orden?: number | null;
};
```

Si el frontend ya tiene estos tipos, solo agrega `imagenPrincipal?: string | null` para mantener compatibilidad mientras se despliega backend/frontend.

## 3. Endpoints de lectura

No cambian las rutas. Solo agrega soporte al nuevo campo en la UI.

```http
GET /api/lineas
GET /api/lineas/:id
GET /api/lineas/buscar/:termino

GET /api/categorias
GET /api/categorias/:id
GET /api/categorias/buscar/:termino
GET /api/categorias/linea/:lineaId
```

Ejemplo de respuesta:

```json
{
  "success": true,
  "data": {
    "id": "jersey",
    "codigo": 1,
    "nombre": "Jersey Oficial",
    "imagenPrincipal": "https://storage.googleapis.com/bucket/lineas/abc.jpg",
    "activo": true
  }
}
```

## 4. Render en frontend publico

Usa `imagenPrincipal` como imagen de portada para tarjetas, filtros destacados, menus visuales o carruseles de lineas/categorias.

```tsx
function CatalogTile({
  title,
  imageUrl,
}: {
  title: string;
  imageUrl?: string | null;
}) {
  return (
    <article className="catalog-tile">
      {imageUrl ? (
        <img src={imageUrl} alt={title} loading="lazy" />
      ) : (
        <div aria-hidden="true" className="catalog-tile__placeholder" />
      )}
      <h3>{title}</h3>
    </article>
  );
}
```

Reglas recomendadas:

- Si `imagenPrincipal` es `null`, mostrar placeholder local.
- No bloquear el listado si una imagen falla; usar `onError` para ocultar/cambiar a placeholder.
- Usar `alt={nombre}`.
- Usar `loading="lazy"` excepto en la primera imagen visible.

## 5. Crear o actualizar con URL existente

Si el admin/frontend ya sube imagenes por otro medio y solo necesita guardar una URL publica:

### Crear linea

```http
POST /api/lineas
Content-Type: application/json
```

```json
{
  "codigo": 1,
  "nombre": "Jersey Oficial",
  "imagenPrincipal": "https://cdn.example.com/lineas/jersey.jpg"
}
```

### Actualizar linea

```http
PUT /api/lineas/:id
Content-Type: application/json
```

```json
{
  "imagenPrincipal": "https://cdn.example.com/lineas/jersey-nueva.webp"
}
```

### Crear categoria

```http
POST /api/categorias
Content-Type: application/json
```

```json
{
  "nombre": "Jersey Hombre",
  "lineaId": "jersey",
  "orden": 1,
  "imagenPrincipal": "https://cdn.example.com/categorias/jersey-hombre.jpg"
}
```

### Limpiar desde JSON

Tambien puedes limpiar el campo mandando:

```json
{
  "imagenPrincipal": null
}
```

## 6. Subir imagen desde archivo

Para que backend suba el archivo a Firebase Storage y actualice `imagenPrincipal`, usa `multipart/form-data`.

Campo del archivo:

```txt
imagen
```

Endpoints:

```http
POST /api/lineas/:id/imagen
POST /api/categorias/:id/imagen
```

Limite actual: 1 imagen por request, maximo 10MB. Se acepta cualquier `image/*`.

Ejemplo:

```ts
export async function uploadLineImage(lineId: string, file: File) {
  const formData = new FormData();
  formData.append("imagen", file);

  const res = await fetch(`/api/lineas/${lineId}/imagen`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error("No se pudo subir la imagen de la linea");
  }

  return res.json() as Promise<{
    success: true;
    data: {
      url: string;
      linea: Linea;
    };
  }>;
}

export async function uploadCategoryImage(categoryId: string, file: File) {
  const formData = new FormData();
  formData.append("imagen", file);

  const res = await fetch(`/api/categorias/${categoryId}/imagen`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error("No se pudo subir la imagen de la categoria");
  }

  return res.json() as Promise<{
    success: true;
    data: {
      url: string;
      categoria: Categoria;
    };
  }>;
}
```

Importante: no seteies manualmente el header `Content-Type` cuando uses `FormData`; el navegador agrega el boundary correcto.

## 7. Eliminar imagen principal

Para borrar la imagen guardada en Storage y dejar `imagenPrincipal: null`:

```http
DELETE /api/lineas/:id/imagen
DELETE /api/categorias/:id/imagen
```

Ejemplo:

```ts
export async function deleteLineImage(lineId: string) {
  const res = await fetch(`/api/lineas/${lineId}/imagen`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error("No se pudo eliminar la imagen de la linea");
  }

  return res.json() as Promise<{ success: true; data: Linea }>;
}
```

## 8. Flujo recomendado para el admin

1. En el formulario de linea/categoria, mostrar preview de `imagenPrincipal`.
2. Permitir seleccionar archivo nuevo con `<input type="file" accept="image/*" />`.
3. Al guardar:
   - Si es una entidad nueva, crear primero la linea/categoria.
   - Luego, si hay archivo seleccionado, llamar a `POST /:id/imagen`.
   - Actualizar el estado local con la entidad devuelta por el backend.
4. Si el usuario elimina la imagen, llamar a `DELETE /:id/imagen` o mandar `imagenPrincipal: null` por `PUT`.

## 9. Checklist de implementacion

- Agregar `imagenPrincipal` a tipos de `Linea` y `Categoria`.
- Mostrar imagen o placeholder en cards/listados.
- Agregar preview y selector de archivo en formularios admin.
- Implementar upload multipart con campo `imagen`.
- Manejar estados `uploading`, `error`, `success`.
- No romper registros existentes con `imagenPrincipal: null`.
- Probar imagenes `.jpg`, `.png`, `.webp` y algun otro formato `image/*` soportado por el navegador.
