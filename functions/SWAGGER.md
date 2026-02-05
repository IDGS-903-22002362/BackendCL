# Documentación API - Swagger/OpenAPI

Este documento explica cómo acceder, usar y mantener la documentación interactiva de la API usando Swagger/OpenAPI 3.0.3.

---

## 📖 Acceder a la Documentación

### Desarrollo Local

Una vez que el servidor de desarrollo esté corriendo:

```bash
npm run dev
```

Accede a la documentación en: **http://localhost:3000/api-docs**

### Producción

En producción (Firebase Functions), la documentación estará disponible en:

```
https://us-central1-e-comerce-leon.cloudfunctions.net/api/api-docs
```

---

## 🔑 Autenticación en Swagger UI

Los endpoints protegidos requieren autenticación JWT de Firebase. Para probarlos en Swagger UI:

### Paso 1: Obtener un Token

Usa uno de los endpoints de autenticación:

- **POST /api/auth/login** - Login con email/password
- **POST /api/auth/social** - Login con Google/Apple
- **POST /api/auth/register-or-login** - Registro o login combinado

La respuesta incluirá un campo `token`:

```json
{
  "success": true,
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

### Paso 2: Configurar el Token en Swagger

1. Haz clic en el botón **"Authorize" 🔓** (esquina superior derecha)
2. En el modal que se abre, pega el token en el campo `Value`
3. Haz clic en **"Authorize"**
4. Cierra el modal

Ahora puedes probar todos los endpoints protegidos marcados con el icono de candado 🔒.

---

## 📚 Estructura de la Documentación

### Tags (Categorías)

Los endpoints están organizados por tags:

| Tag                | Descripción                   | Endpoints                                              |
| ------------------ | ----------------------------- | ------------------------------------------------------ |
| **Products**       | Gestión de productos          | 11 endpoints (GET, POST, PUT, DELETE, imágenes)        |
| **Lines**          | Gestión de líneas             | 7 endpoints (CRUD + búsqueda)                          |
| **Categories**     | Gestión de categorías         | 8 endpoints (CRUD + búsqueda + filtro por línea)       |
| **Providers**      | Gestión de proveedores        | 7 endpoints (CRUD + búsqueda)                          |
| **Sizes**          | Gestión de tallas             | 6 endpoints (CRUD)                                     |
| **Users**          | Gestión de usuarios           | 9 endpoints (CRUD + búsqueda + operaciones especiales) |
| **Authentication** | Autenticación y autorización  | 3 endpoints (login, social, registro)                  |
| **Debug**          | Diagnóstico (solo desarrollo) | Endpoints deprecated para troubleshooting              |

### Formatos de Respuesta

#### Respuestas Exitosas

**Lista de recursos (GET /recurso):**

```json
{
  "success": true,
  "count": 10,
  "data": [...]
}
```

**Recurso individual (GET /recurso/:id):**

```json
{
  "success": true,
  "data": {...}
}
```

**Creación (POST):**

```json
{
  "success": true,
  "message": "Recurso creado exitosamente",
  "data": {...}
}
```

#### Respuestas de Error

**Error de validación (400):**

```json
{
  "success": false,
  "message": "Validación fallida",
  "errors": [
    {
      "campo": "email",
      "mensaje": "El email debe ser válido",
      "codigo": "invalid_string"
    }
  ]
}
```

**Recurso no encontrado (404):**

```json
{
  "success": false,
  "message": "Recurso con ID \"xyz\" no encontrado"
}
```

**No autorizado (401):**

```json
{
  "success": false,
  "message": "No autorizado"
}
```

---

## 🛠️ Cómo Documentar Nuevos Endpoints

Cuando agregues un nuevo endpoint, sigue este patrón de documentación JSDoc:

### Plantilla Básica

```typescript
/**
 * @swagger
 * /api/recurso:
 *   get:
 *     summary: Breve descripción del endpoint
 *     description: Descripción detallada del comportamiento
 *     tags: [NombreDelTag]
 *     responses:
 *       200:
 *         description: Respuesta exitosa
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", controller.method);
```

### Con Parámetros de Ruta

```typescript
/**
 * @swagger
 * /api/recurso/{id}:
 *   get:
 *     summary: Obtener recurso por ID
 *     tags: [Recurso]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del recurso
 *         schema:
 *           type: string
 *           example: "abc123"
 *     responses:
 *       200:
 *         $ref: '#/components/responses/200Success'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 */
```

### Con Request Body (POST/PUT)

```typescript
/**
 * @swagger
 * /api/recurso:
 *   post:
 *     summary: Crear nuevo recurso
 *     tags: [Recurso]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRecurso'
 *           example:
 *             nombre: "Ejemplo"
 *             valor: 100
 *     responses:
 *       201:
 *         $ref: '#/components/responses/201Created'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 */
```

### Con Autenticación Requerida

```typescript
/**
 * @swagger
 * /api/recurso-protegido:
 *   get:
 *     summary: Endpoint protegido
 *     tags: [Recurso]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Éxito
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 */
```

---

## 🔧 Integración con Zod

Este proyecto usa **Zod** para validación de datos. Los schemas de Zod se convierten automáticamente a JSON Schema para Swagger.

### Agregar Nuevo Schema Zod a Swagger

**1. Define tu schema Zod** en `src/middleware/validators/*.validator.ts`:

```typescript
import { z } from "zod";

export const createRecursoSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100),
    valor: z.number().positive(),
  })
  .strict();
```

**2. Importa el schema en `swagger.config.ts`**:

```typescript
import { createRecursoSchema } from "../middleware/validators/recurso.validator";
```

**3. Agrégalo a `components.schemas`**:

```typescript
components: {
  schemas: {
    CreateRecurso: zodToJsonSchema(createRecursoSchema),
    // ... otros schemas
  }
}
```

**4. Referéncialo en tus rutas**:

```typescript
/**
 * @swagger
 * ...
 *   requestBody:
 *     content:
 *       application/json:
 *         schema:
 *           $ref: '#/components/schemas/CreateRecurso'
 */
```

---

## 📋 Respuestas Reutilizables

El archivo `swagger.config.ts` define respuestas estándar reutilizables:

- `#/components/responses/200Success` - Operación exitosa
- `#/components/responses/201Created` - Recurso creado
- `#/components/responses/400BadRequest` - Error de validación
- `#/components/responses/401Unauthorized` - No autorizado
- `#/components/responses/403Forbidden` - Sin permisos
- `#/components/responses/404NotFound` - Recurso no encontrado
- `#/components/responses/500ServerError` - Error del servidor

Usa estas referencias en lugar de duplicar la definición:

```typescript
responses:
  200:
    $ref: '#/components/responses/200Success'
  404:
    $ref: '#/components/responses/404NotFound'
```

---

## 🚀 Best Practices

### ✅ DO (Hacer)

- ✅ Documentar **todos los endpoints** (incluidos los de debug, marcándolos como `deprecated: true`)
- ✅ Usar **tags consistentes** para agrupar endpoints relacionados
- ✅ Incluir **ejemplos realistas** en request bodies
- ✅ Referenciar **schemas de Zod** para mantener consistencia con la validación
- ✅ Documentar **todos los códigos de respuesta posibles** (200, 400, 404, 500, etc.)
- ✅ Agregar **descripciones claras** de lo que hace cada endpoint
- ✅ Marcar endpoints protegidos con `security: [{ BearerAuth: [] }]`

### ❌ DON'T (No hacer)

- ❌ No duplicar schemas manualmente (usa `$ref` para reutilizar)
- ❌ No omitir documentación de endpoints existentes
- ❌ No usar tipos genéricos como `object` sin propiedades
- ❌ No documentar endpoints sin especificar respuestas de error
- ❌ No olvidar actualizar la documentación al modificar endpoints

---

## 🧪 Validación del Spec

Para validar que el spec de OpenAPI es correcto:

### Opción 1: Swagger Editor Online

1. Genera el spec JSON: accede a `http://localhost:3000/api-docs.json` (si habilitas el endpoint)
2. Visita https://editor.swagger.io/
3. Pega el contenido y revisa errores

### Opción 2: Validador CLI

```bash
npm install -g swagger-cli
npx swagger-cli validate functions/src/config/swagger.config.ts
```

---

## 🐛 Troubleshooting

### El endpoint /api-docs no carga

**Problema:** La página de Swagger UI no se muestra.

**Soluciones:**

1. Verifica que el servidor esté corriendo: `npm run dev`
2. Revisa errores en la consola del servidor
3. Confirma que las rutas están importadas correctamente
4. Verifica sintaxis JSDoc (errores silenciosos pueden romper el spec)

### Schemas de Zod no aparecen

**Problema:** Los schemas no se muestran en Swagger UI.

**Soluciones:**

1. Verifica imports en `swagger.config.ts`
2. Confirma que `zodToJsonSchema` se está llamando correctamente
3. Revisa que el schema Zod sea válido (sin errores de sintaxis)

### Endpoints no aparecen

**Problema:** Algunos endpoints no se muestran en Swagger UI.

**Soluciones:**

1. Verifica que la ruta del archivo esté en `apis` en `swagger.config.ts`
2. Confirma que el JSDoc empiece con `@swagger`
3. Revisa indentación del YAML (debe ser correcta)
4. Asegúrate de que el router esté montado en `routes/index.ts`

### Error: "Unknown tag"

**Problema:** Swagger muestra error de tag desconocido.

**Solución:**

Agrega el tag a la sección `tags` en `swagger.config.ts`:

```typescript
tags: [
  {
    name: "NuevoTag",
    description: "Descripción del nuevo tag",
  },
];
```

---

## 📝 Changelog de Documentación

Cuando modifiques la documentación de la API, actualiza esta sección:

| Fecha      | Cambio                                                | Autor   |
| ---------- | ----------------------------------------------------- | ------- |
| 2024-02-05 | Documentación inicial completa de todos los endpoints | Copilot |

---

## 📚 Referencias

- [OpenAPI 3.0.3 Specification](https://swagger.io/specification/)
- [Swagger UI Documentation](https://swagger.io/docs/open-source-tools/swagger-ui/)
- [swagger-jsdoc Documentation](https://github.com/Surnet/swagger-jsdoc)
- [Zod to JSON Schema](https://github.com/StefanTerdell/zod-to-json-schema)
- [AGENTS.MD](../AGENTS.MD) - Reglas de desarrollo del proyecto

---

**¿Preguntas?** Consulta el archivo `AGENTS.MD` para reglas específicas del proyecto o revisa los ejemplos en los archivos de rutas existentes.
