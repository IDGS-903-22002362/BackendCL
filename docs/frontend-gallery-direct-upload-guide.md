# Guia frontend: Subida directa de media para Galeria

Ultima actualizacion: 2026-06-15

Esta guia explica como migrar el frontend de Galeria para subir imagenes y videos directamente a Firebase Storage y registrar solo metadata en el backend.

El objetivo es evitar que videos e imagenes pesadas pasen por Cloud Functions/Express. El backend ya no debe recibir archivos binarios en el nuevo flujo; solo recibe JSON.

## 1. Reglas importantes

- Para el nuevo flujo de Galeria, no usar `multipart/form-data`.
- No enviar archivos al backend.
- El frontend sube el archivo con Firebase Web SDK a Storage.
- Despues de subir, el frontend llama al backend con `Content-Type: application/json`.
- El campo `storagePath` debe empezar con `galeria/{galeriaId}/`.
- El backend conserva compatibilidad agregando la URL a `imagenes` o `videos`, pero la metadata completa se guarda en subcoleccion.
- Los endpoints legacy de multipart pueden seguir existiendo, pero para videos se debe usar este flujo nuevo.

## 2. Endpoint backend

```http
POST /api/galeria/:galeriaId/media/metadata
Authorization: Bearer <jwt-backend>
Content-Type: application/json
```

Body:

```ts
type GalleryMediaMetadataRequest = {
  tipo: "imagen" | "video";
  url: string;
  storagePath: string;
  contentType: string;
  size: number;
  nombreOriginal: string;
  width?: number;
  height?: number;
  duration?: number;
  orden?: number;
};
```

Respuesta exitosa:

```ts
type GalleryMediaMetadataResponse = {
  success: true;
  message: "Metadata de archivo guardada correctamente";
  data: {
    id: string;
    galeriaId: string;
    tipo: "imagen" | "video";
    url: string;
    storagePath: string;
    contentType: string;
    size: number;
    nombreOriginal: string;
    creadoEn: string;
  };
};
```

## 3. Validaciones que debe respetar el frontend

Tipos permitidos:

```ts
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
```

Limites:

```ts
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
```

Antes de subir:

- Si es imagen, validar `file.type` contra `ALLOWED_IMAGE_TYPES`.
- Si es video, validar `file.type` contra `ALLOWED_VIDEO_TYPES`.
- Validar `file.size`.
- Mostrar error al usuario antes de llamar Firebase Storage si no cumple.

## 4. Storage path obligatorio

El path debe pertenecer a Galeria:

```ts
galeria/{galeriaId}/{timestamp}_{safeFileName}
```

Ejemplo:

```ts
function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildGalleryStoragePath(galeriaId: string, file: File) {
  return `galeria/${galeriaId}/${Date.now()}_${sanitizeFileName(file.name)}`;
}
```

No usar paths como:

```txt
productos/...
banners/...
videos/...
reels/...
```

El backend rechazara cualquier `storagePath` que no empiece con `galeria/{galeriaId}/`.

## 5. Subir a Firebase Storage

Ejemplo usando Firebase Web SDK:

```ts
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

type UploadGalleryMediaInput = {
  galeriaId: string;
  file: File;
  tipo: "imagen" | "video";
  onProgress?: (progress: number) => void;
};

export async function uploadGalleryMediaToStorage({
  galeriaId,
  file,
  tipo,
  onProgress,
}: UploadGalleryMediaInput) {
  validateGalleryFile(file, tipo);

  const storage = getStorage();
  const storagePath = buildGalleryStoragePath(galeriaId, file);
  const fileRef = ref(storage, storagePath);

  const uploadTask = uploadBytesResumable(fileRef, file, {
    contentType: file.type,
  });

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress =
          snapshot.totalBytes > 0
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;
        onProgress?.(progress);
      },
      reject,
      () => resolve(),
    );
  });

  const url = await getDownloadURL(uploadTask.snapshot.ref);

  return {
    tipo,
    url,
    storagePath,
    contentType: file.type,
    size: file.size,
    nombreOriginal: file.name,
  };
}
```

Validador local:

```ts
function validateGalleryFile(file: File, tipo: "imagen" | "video") {
  if (tipo === "imagen") {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("Formato de imagen no permitido");
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error("La imagen excede el limite de 10 MB");
    }
  }

  if (tipo === "video") {
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      throw new Error("Formato de video no permitido");
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error("El video excede el limite de 200 MB");
    }
  }
}
```

## 6. Registrar metadata en backend

Despues de obtener `downloadURL`:

```ts
export async function saveGalleryMediaMetadata(
  apiBaseUrl: string,
  token: string,
  galeriaId: string,
  metadata: GalleryMediaMetadataRequest,
) {
  const res = await fetch(
    `${apiBaseUrl}/api/galeria/${galeriaId}/media/metadata`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    },
  );

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      payload?.message || "No se pudo guardar la metadata del archivo",
    );
  }

  return payload as GalleryMediaMetadataResponse;
}
```

Flujo completo:

```ts
export async function uploadAndRegisterGalleryMedia(params: {
  apiBaseUrl: string;
  token: string;
  galeriaId: string;
  file: File;
  tipo: "imagen" | "video";
  onProgress?: (progress: number) => void;
}) {
  const metadata = await uploadGalleryMediaToStorage({
    galeriaId: params.galeriaId,
    file: params.file,
    tipo: params.tipo,
    onProgress: params.onProgress,
  });

  return saveGalleryMediaMetadata(
    params.apiBaseUrl,
    params.token,
    params.galeriaId,
    metadata,
  );
}
```

## 7. Obtener dimensiones opcionales

Para imagen:

```ts
export async function getImageDimensions(file: File) {
  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = url;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo leer la imagen"));
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

Para video:

```ts
export async function getVideoMetadata(file: File) {
  const url = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("No se pudo leer el video"));
    });

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

Uso:

```ts
const baseMetadata = await uploadGalleryMediaToStorage({
  galeriaId,
  file,
  tipo,
  onProgress,
});

const extra =
  tipo === "imagen"
    ? await getImageDimensions(file)
    : await getVideoMetadata(file);

await saveGalleryMediaMetadata(apiBaseUrl, token, galeriaId, {
  ...baseMetadata,
  ...extra,
});
```

## 8. Cambios recomendados en UI

- Mostrar progreso de subida usando `uploadBytesResumable`.
- Deshabilitar el boton de guardar mientras sube el archivo.
- Si falla la subida a Storage, no llamar al backend.
- Si falla el guardado de metadata, mostrar error y permitir reintentar solo el registro.
- Al finalizar, refrescar `GET /api/galeria/:id` o actualizar localmente el array `imagenes`/`videos` con la URL retornada.
- Para videos, mostrar estado claro: `Subiendo`, `Procesando metadata`, `Listo`, `Error`.

## 9. Manejo de errores

Errores esperados del backend:

- `400`: metadata invalida, tipo no permitido, contentType incorrecto, path fuera de Galeria o size excedido.
- `401`: falta token.
- `404`: la galeria no existe.
- `500`: error inesperado.

Ejemplo:

```ts
try {
  await uploadAndRegisterGalleryMedia({
    apiBaseUrl,
    token,
    galeriaId,
    file,
    tipo,
    onProgress: setProgress,
  });
} catch (error) {
  console.error(error);
  showToast(error instanceof Error ? error.message : "No se pudo subir el archivo");
}
```

## 10. Que NO debe hacer el frontend

- No llamar `POST /api/galeria/:id/videos` para videos nuevos.
- No llamar `POST /api/galeria/:id/imagenes` para el nuevo flujo.
- No mandar `FormData` al endpoint `/media/metadata`.
- No poner `multipart/form-data` en el endpoint nuevo.
- No inventar `storagePath`; debe coincidir con el objeto subido a Firebase Storage.
- No usar paths fuera de `galeria/{galeriaId}/`.
- No llamar al backend antes de que `getDownloadURL` termine.

## 11. Checklist de pruebas manuales

Imagen:

- Crear o seleccionar una galeria.
- Subir una imagen `jpg`, `jpeg`, `png` o `webp` menor a 10 MB.
- Confirmar que se crea el objeto en Storage bajo `galeria/{galeriaId}/`.
- Confirmar que `POST /media/metadata` responde `201`.
- Confirmar que `GET /api/galeria/:id` incluye la URL en `imagenes`.

Video:

- Subir video `mp4`, `webm` o `quicktime` menor a 200 MB.
- Confirmar progreso visual durante la subida.
- Confirmar que `POST /media/metadata` responde `201`.
- Confirmar que `GET /api/galeria/:id` incluye la URL en `videos`.

Validaciones:

- Intentar subir PDF y confirmar error local antes de Storage.
- Intentar imagen mayor a 10 MB y confirmar error local.
- Intentar video mayor a 200 MB y confirmar error local.
- Forzar un `storagePath` incorrecto y confirmar que backend responde `400`.
- Probar sin token y confirmar `401`.

Regresion:

- Confirmar que Galeria sigue listando imagenes existentes.
- Confirmar que videos existentes en el array legacy siguen renderizando.
- Confirmar que checkout, pagos, productos, banners, carrito y FedEx no cambian.

