# Guia frontend: Catalogo paginado y activar/ocultar productos

Ultima actualizacion: 2026-06-05

Esta guia explica que debe cambiar el frontend para consumir:

- Catalogo publico paginado: `GET /api/productos/catalogo`
- Listado admin con productos activos/inactivos: `GET /api/productos/admin`
- Activar u ocultar productos desde admin: `PATCH /api/productos/:id/estado`

El objetivo es que la tienda publica deje de cargar todos los productos y que el panel admin pueda ocultar productos por licencia, lanzamiento pendiente, stock estrategico o decision comercial, sin romper carrito, checkout, pagos, ordenes ni inventario.

## 1. Reglas importantes

- La tienda publica debe usar `GET /api/productos/catalogo`, no `GET /api/productos`, para la pagina `/products`.
- El catalogo publico solo devuelve productos `activo=true`.
- El admin debe usar `GET /api/productos/admin?estado=todos` para poder ver y reactivar productos ocultos.
- Para ocultar un producto, usar `PATCH /api/productos/:id/estado` con `{ "activo": false }`.
- Para reactivar un producto, usar `PATCH /api/productos/:id/estado` con `{ "activo": true }`.
- No aplicar codigos promocionales en catalogo. Los codigos siguen perteneciendo a carrito/checkout.
- El precio real cobrado se sigue calculando en backend durante checkout.
- Si `onlyOffers=true`, en esta version puede devolver lista vacia porque el backend aun no tiene motor formal de ofertas automaticas.

## 2. Catalogo publico paginado

Endpoint:

```http
GET /api/productos/catalogo
```

No requiere token.

Query params soportados:

```ts
type CatalogSort =
  | "destacados"
  | "precio_asc"
  | "precio_desc"
  | "recientes"
  | "nombre_asc";

type CatalogQuery = {
  limit?: number; // default 24, max 48
  cursor?: string;
  category?: string;
  categoria?: string;
  line?: string;
  linea?: string;
  talla?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: CatalogSort;
  q?: string;
  onlyOffers?: boolean;
  onlyAvailable?: boolean;
};
```

Respuesta:

```ts
type CatalogResponse = {
  items: CatalogProductCard[];
  nextCursor: string | null;
  hasMore: boolean;
};

type CatalogProductCard = {
  id: string;
  slug: string;
  nombre: string;
  categoria: string;
  categoriaLabel: string;
  linea: string;
  lineaLabel: string;
  precioOriginal: number;
  precioFinal: number;
  tieneOferta: boolean;
  ofertaAplicadaId: string | null;
  ofertaTitulo: string | null;
  descuentoTotal: number;
  imagenPrincipal: string | null;
  stockTotal: number;
  disponible: boolean;
  destacado: boolean;
};
```

Ejemplo de request:

```ts
export async function fetchCatalogPage(params: CatalogQuery = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const res = await fetch(`/api/productos/catalogo?${searchParams.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo cargar el catalogo");
  }

  return (await res.json()) as CatalogResponse;
}
```

Ejemplo de uso en `/products`:

```ts
const firstPage = await fetchCatalogPage({
  limit: 24,
  sort: "destacados",
  onlyAvailable: true,
});

const nextPage =
  firstPage.hasMore && firstPage.nextCursor
    ? await fetchCatalogPage({
        limit: 24,
        cursor: firstPage.nextCursor,
        sort: "destacados",
        onlyAvailable: true,
      })
    : null;
```

## 3. Cambios recomendados en `/products`

Antes:

- Cargar todos los productos.
- Filtrar/ordenar en memoria.
- Renderizar toda la lista o paginar localmente.

Ahora:

- Mantener estado de filtros en la URL o store.
- Pedir al backend solo la pagina actual.
- Usar `nextCursor` para "Cargar mas" o infinite scroll.
- Al cambiar cualquier filtro, limpiar `items` y `cursor`.
- No reutilizar un cursor si cambia `category`, `line`, `talla`, precio, `sort`, `q`, `onlyOffers` u `onlyAvailable`.

Estado sugerido:

```ts
type CatalogState = {
  items: CatalogProductCard[];
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  filters: {
    category?: string;
    line?: string;
    talla?: string;
    minPrice?: number;
    maxPrice?: number;
    sort: CatalogSort;
    q?: string;
    onlyOffers: boolean;
    onlyAvailable: boolean;
  };
};
```

Al renderizar cards:

- Usar `imagenPrincipal`; si es `null`, mostrar placeholder local.
- Mostrar `precioFinal`.
- Si `tieneOferta=true`, mostrar tambien `precioOriginal` tachado y badge con `ofertaTitulo`.
- Si `disponible=false`, deshabilitar CTA de agregar al carrito o mostrar "Agotado".
- Usar `slug` para links amigables si el frontend lo soporta; si no, seguir usando `id`.

## 4. Filtros y ordenamientos

Mapeo UI recomendado:

| UI | Query |
| --- | --- |
| Categoria | `category=<categoriaId>` |
| Linea | `line=<lineaId>` |
| Talla | `talla=<tallaId>` |
| Precio minimo | `minPrice=500` |
| Precio maximo | `maxPrice=1500` |
| Solo disponibles | `onlyAvailable=true` |
| Solo ofertas | `onlyOffers=true` |
| Busqueda | `q=jersey` |
| Destacados | `sort=destacados` |
| Precio menor a mayor | `sort=precio_asc` |
| Precio mayor a menor | `sort=precio_desc` |
| Recientes | `sort=recientes` |
| Nombre A-Z | `sort=nombre_asc` |

Notas:

- Si usas `minPrice` o `maxPrice`, manda tambien `sort=precio_asc` o `sort=precio_desc`.
- Si el backend responde `400`, muestra un mensaje amable y limpia el cursor.
- Para busqueda `q`, considera debounce de 300 a 500 ms.

## 5. Listado admin de productos

Endpoint:

```http
GET /api/productos/admin?estado=todos
Authorization: Bearer <jwt-backend>
```

Requiere usuario admin.

Query:

```ts
type AdminProductStatus = "todos" | "activo" | "inactivo";
```

Respuesta:

```ts
type AdminProductsResponse = {
  success: boolean;
  count: number;
  data: AdminProductListItem[];
};

type AdminProductListItem = {
  id: string;
  clave: string;
  descripcion: string;
  slug: string;
  lineaId: string;
  categoriaId: string;
  precioPublico: number;
  existencias: number;
  disponible: boolean;
  destacado: boolean;
  activo: boolean;
  imagenPrincipal: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};
```

Ejemplo:

```ts
export async function fetchAdminProducts(
  token: string,
  estado: AdminProductStatus = "todos",
) {
  const res = await fetch(`/api/productos/admin?estado=${estado}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("No se pudieron cargar los productos del admin");
  }

  return (await res.json()) as AdminProductsResponse;
}
```

Cambios en UI admin:

- Agregar tabs o filtro: `Todos`, `Activos`, `Ocultos`.
- Mostrar una columna o badge de estado:
  - `activo=true`: "Visible en tienda"
  - `activo=false`: "Oculto"
- En productos ocultos, mostrar boton "Activar".
- En productos activos, mostrar boton "Ocultar".
- No eliminar visualmente el producto al ocultarlo si el admin esta en `estado=todos`; solo actualizar el badge.
- Si el admin esta en `estado=activo` y oculta un producto, removerlo de esa lista o recargar.
- Si el admin esta en `estado=inactivo` y reactiva un producto, removerlo de esa lista o recargar.

## 6. Activar u ocultar producto

Endpoint:

```http
PATCH /api/productos/:id/estado
Authorization: Bearer <jwt-backend>
Content-Type: application/json
```

Body para ocultar:

```json
{
  "activo": false
}
```

Body para activar:

```json
{
  "activo": true
}
```

Ejemplo:

```ts
export async function setProductActiveStatus(
  token: string,
  productId: string,
  activo: boolean,
) {
  const res = await fetch(`/api/productos/${productId}/estado`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ activo }),
  });

  if (!res.ok) {
    throw new Error(
      activo
        ? "No se pudo activar el producto"
        : "No se pudo ocultar el producto",
    );
  }

  return (await res.json()) as {
    success: boolean;
    message: string;
    data: unknown;
  };
}
```

Patron UI recomendado:

```ts
async function onToggleProduct(product: AdminProductListItem) {
  const nextStatus = !product.activo;

  // Confirmar para evitar ocultar por accidente.
  const ok = window.confirm(
    nextStatus
      ? "Este producto volvera a mostrarse en la tienda. Continuar?"
      : "Este producto se ocultara de la tienda publica. Continuar?",
  );

  if (!ok) return;

  await setProductActiveStatus(token, product.id, nextStatus);

  // Opcion simple y segura:
  await reloadAdminProducts();
}
```

## 7. Crear productos ocultos

El endpoint existente de crear producto ya acepta `activo`.

Para crear un producto que aun no debe mostrarse al cliente:

```json
{
  "clave": "LIC-001",
  "descripcion": "Producto pendiente de licencia",
  "lineaId": "hombre",
  "categoriaId": "jerseys",
  "precioPublico": 1200,
  "precioCompra": 600,
  "existencias": 10,
  "proveedorId": "proveedor_1",
  "tallaIds": [],
  "inventarioPorTalla": [],
  "imagenes": [],
  "detalleIds": [],
  "activo": false
}
```

En el formulario admin:

- Agregar switch: "Visible en tienda".
- Default recomendado: visible (`activo=true`) si el flujo actual ya publica productos al crearlos.
- Para productos con licencia pendiente, desactivar el switch antes de guardar.
- En la pantalla de edicion, precargar el valor actual de `activo`.

## 8. Que NO debe cambiar en frontend

- No cambiar el flujo de checkout.
- No recalcular totales finales desde el catalogo.
- No aplicar codigos promocionales en catalogo.
- No cambiar Stripe ni Aplazo.
- No confiar en precios visuales para cobrar.
- No usar `GET /api/productos/admin` en la tienda publica.
- No mostrar productos `activo=false` a clientes.

## 9. Manejo de errores

Casos esperados:

- `400`: query o body invalido. Revisar params, limpiar cursor si aplica.
- `401`: falta token en endpoints admin.
- `403`: usuario no es admin.
- `404`: producto no existe al activar/ocultar.
- `500`: error inesperado; mostrar toast generico y permitir reintento.

Ejemplo de handler:

```ts
async function safeRequest<T>(request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    console.error(error);
    // Mostrar toast o estado de error en UI.
    throw error;
  }
}
```

## 10. Checklist de pruebas manuales

Catalogo publico:

- Abrir `/products` y confirmar que carga 24 productos o menos.
- Cargar siguiente pagina usando `nextCursor`.
- Cambiar categoria y confirmar que se limpia el cursor.
- Probar `sort=precio_asc` y `sort=precio_desc`.
- Probar `onlyAvailable=true`.
- Probar producto sin imagen y validar placeholder.
- Confirmar que productos ocultos no aparecen.

Admin:

- Crear producto con `activo=false`.
- Confirmar que aparece en `GET /api/productos/admin?estado=inactivo`.
- Confirmar que no aparece en tienda publica.
- Activarlo desde admin.
- Confirmar que aparece en tienda publica.
- Ocultarlo desde admin.
- Confirmar que desaparece de tienda publica, carrito nuevo y favoritos nuevos.

Regresion:

- Agregar producto activo al carrito.
- Intentar checkout normal.
- Confirmar que total de checkout se sigue calculando en backend.
- Confirmar que Stripe/Aplazo no cambian.
- Confirmar que ordenes e inventario siguen funcionando.
