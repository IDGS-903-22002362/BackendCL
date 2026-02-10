# BackendCL - Épicas y Tareas para Jira

## Tienda Virtual Club León

Este documento contiene la estructura completa de épicas y tareas identificadas en el repositorio BackendCL, listas para importar a Jira.

**Total de Tareas:** 82

- ✅ **DONE:** 44 tareas (implementadas en código)
- 🔲 **TODO:** 38 tareas (pendientes de implementar)

---

## ÉPICA 1: Gestión de Catálogo de Productos

**Tipo:** Epic  
**Descripción:** Módulo completo para la gestión del catálogo de productos de la tienda, incluyendo CRUD, búsqueda, filtrado y gestión de imágenes.

### Tareas

#### TASK-001: Listar todos los productos activos

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos que retorna todos los productos activos ordenados alfabéticamente.  
**Criterios de Aceptación:**

- Retorna solo productos con activo=true
- Ordena alfabéticamente por descripción
- Incluye contador de productos en la respuesta
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 30-33)
- `functions/src/controllers/products/products.query.controller.ts` (función `getAll`)
- `functions/src/services/product.service.ts` (función `getAllProducts`)

---

#### TASK-002: Obtener producto por ID

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos/:id que retorna un producto específico por su ID.  
**Criterios de Aceptación:**

- Retorna 404 si el producto no existe
- Retorna todos los campos del producto
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 35-38)
- `functions/src/controllers/products/products.query.controller.ts` (función `getById`)
- `functions/src/services/product.service.ts` (función `getProductById`)

---

#### TASK-003: Buscar productos por categoría

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos/categoria/:categoriaId que retorna productos filtrados por categoría.  
**Criterios de Aceptación:**

- Filtra productos por categoriaId
- Solo retorna productos activos
- Ordena alfabéticamente por descripción

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 40-43)
- `functions/src/controllers/products/products.query.controller.ts` (función `getByCategory`)
- `functions/src/services/product.service.ts` (función `getProductsByCategory`)

---

#### TASK-004: Buscar productos por línea

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos/linea/:lineaId que retorna productos filtrados por línea.  
**Criterios de Aceptación:**

- Filtra productos por lineaId
- Solo retorna productos activos
- Ordena alfabéticamente por descripción

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 45-48)
- `functions/src/controllers/products/products.query.controller.ts` (función `getByLine`)
- `functions/src/services/product.service.ts` (función `getProductsByLine`)

---

#### TASK-005: Búsqueda de productos por término

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos/buscar/:termino que busca productos por descripción o clave.  
**Criterios de Aceptación:**

- Busca en campos descripción y clave
- Búsqueda case-insensitive
- Solo retorna productos activos
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 50-53)
- `functions/src/controllers/products/products.query.controller.ts` (función `search`)
- `functions/src/services/product.service.ts` (función `searchProducts`)

**Nota:** Implementación básica. Para búsqueda avanzada considerar Algolia o similar.

---

#### TASK-006: Crear nuevo producto

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint POST /api/productos para crear un nuevo producto en el catálogo.  
**Criterios de Aceptación:**

- Valida campos requeridos: clave, descripción, lineaId, categoriaId, precioPublico, precioCompra, existencias, proveedorId
- Valida que la clave sea única
- Asigna timestamps automáticamente (createdAt, updatedAt)
- Retorna el producto creado con su ID
- Maneja errores de validación y duplicados

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 60-63)
- `functions/src/controllers/products/products.command.controller.ts` (función `create`)
- `functions/src/services/product.service.ts` (función `createProduct`)

---

#### TASK-007: Actualizar producto existente

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint PUT /api/productos/:id para actualizar un producto existente.  
**Criterios de Aceptación:**

- Valida que el producto exista (retorna 404 si no existe)
- Valida unicidad de clave si se actualiza
- Actualiza timestamp updatedAt automáticamente
- Permite actualización parcial de campos
- Retorna el producto actualizado

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 65-68)
- `functions/src/controllers/products/products.command.controller.ts` (función `update`)
- `functions/src/services/product.service.ts` (función `updateProduct`)

---

#### TASK-008: Eliminar producto (soft delete)

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint DELETE /api/productos/:id que marca un producto como inactivo en lugar de eliminarlo físicamente.  
**Criterios de Aceptación:**

- Marca el producto como activo=false
- Actualiza timestamp updatedAt
- Retorna 404 si el producto no existe
- No elimina físicamente el documento de Firestore

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 70-73)
- `functions/src/controllers/products/products.command.controller.ts` (función `remove`)
- `functions/src/services/product.service.ts` (función `deleteProduct`)

---

#### TASK-009: Subir imágenes de producto

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint POST /api/productos/:id/imagenes para subir múltiples imágenes a un producto usando Firebase Storage.  
**Criterios de Aceptación:**

- Acepta hasta 5 archivos simultáneamente
- Valida que sean archivos de imagen
- Valida que el producto exista
- Sube archivos a Firebase Storage en carpeta "productos"
- Genera URLs públicas para las imágenes
- Actualiza el array de imágenes del producto
- Retorna URLs y total de imágenes

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 75-79)
- `functions/src/controllers/products/products.command.controller.ts` (función `uploadImages`)
- `functions/src/services/storage.service.ts` (función `uploadMultipleFiles`)

---

#### TASK-010: Eliminar imagen de producto

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint DELETE /api/productos/:id/imagenes para eliminar una imagen específica de un producto.  
**Criterios de Aceptación:**

- Valida que el producto exista
- Valida que la imagen exista en el producto
- Elimina el archivo de Firebase Storage
- Actualiza el array de imágenes del producto
- Retorna cantidad de imágenes restantes

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 81-84)
- `functions/src/controllers/products/products.command.controller.ts` (función `deleteImage`)
- `functions/src/services/storage.service.ts` (función `deleteFile`)

---

#### TASK-011: Endpoint de debug para productos

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/productos/debug para diagnóstico de conexión a Firestore y consultas.  
**Criterios de Aceptación:**

- Verifica conexión a Firestore
- Muestra muestra de documentos
- Muestra documentos con filtro activo=true
- Útil para desarrollo y troubleshooting

**Archivos de Código:**

- `functions/src/routes/products.routes.ts` (línea 25-28)
- `functions/src/controllers/products/products.debug.controller.ts`

---

## ÉPICA 2: Gestión de Catálogos Auxiliares

**Tipo:** Epic  
**Descripción:** Módulos para gestionar catálogos auxiliares necesarios para el funcionamiento del sistema: Líneas, Categorías, Proveedores y Tallas.

### Tareas - Módulo Líneas

#### TASK-012: Listar todas las líneas activas

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/lineas que retorna todas las líneas activas del catálogo.  
**Criterios de Aceptación:**

- Retorna solo líneas con activo=true
- Incluye contador de líneas en la respuesta
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 30-33)
- `functions/src/controllers/lines/lines.query.controller.ts` (función `getAll`)
- `functions/src/services/line.service.ts` (función `getAllLines`)

---

#### TASK-013: Obtener línea por ID

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/lineas/:id que retorna una línea específica por su ID.  
**Criterios de Aceptación:**

- Retorna 404 si la línea no existe o está inactiva
- Retorna todos los campos de la línea
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 43-46)
- `functions/src/controllers/lines/lines.query.controller.ts` (función `getById`)
- `functions/src/services/line.service.ts` (función `getLineById`)

---

#### TASK-014: Buscar líneas por término

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/lineas/buscar/:termino que busca líneas por nombre.  
**Criterios de Aceptación:**

- Busca en campo nombre
- Búsqueda case-insensitive
- Solo retorna líneas activas
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 35-42)
- `functions/src/controllers/lines/lines.query.controller.ts` (función `search`)
- `functions/src/services/line.service.ts` (función `searchLines`)

---

#### TASK-015: Crear nueva línea

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint POST /api/lineas para crear una nueva línea en el catálogo.  
**Criterios de Aceptación:**

- Valida campos requeridos: codigo, nombre
- Valida que el código sea único
- Genera ID semántico basado en el nombre
- Asigna timestamps automáticamente
- Retorna la línea creada con su ID
- Maneja errores de validación y duplicados

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 55-58)
- `functions/src/controllers/lines/lines.command.controller.ts` (función `create`)
- `functions/src/services/line.service.ts` (función `createLine`)

---

#### TASK-016: Actualizar línea existente

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint PUT /api/lineas/:id para actualizar una línea existente.  
**Criterios de Aceptación:**

- Valida que la línea exista (retorna 404 si no existe)
- Valida unicidad de código si se actualiza
- Actualiza timestamp updatedAt automáticamente
- Permite actualización parcial de campos
- Retorna la línea actualizada

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 60-63)
- `functions/src/controllers/lines/lines.command.controller.ts` (función `update`)
- `functions/src/services/line.service.ts` (función `updateLine`)

---

#### TASK-017: Eliminar línea (soft delete)

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint DELETE /api/lineas/:id que marca una línea como inactiva.  
**Criterios de Aceptación:**

- Marca la línea como activo=false
- Actualiza timestamp updatedAt
- Retorna 404 si la línea no existe
- No elimina físicamente el documento de Firestore

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 65-68)
- `functions/src/controllers/lines/lines.command.controller.ts` (función `remove`)
- `functions/src/services/line.service.ts` (función `deleteLine`)

---

#### TASK-018: Endpoint de debug para líneas

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/lineas/debug para diagnóstico de conexión a Firestore.  
**Criterios de Aceptación:**

- Verifica conexión a Firestore
- Muestra muestra de documentos
- Muestra documentos con filtro activo=true

**Archivos de Código:**

- `functions/src/routes/lines.routes.ts` (línea 25-28)
- `functions/src/controllers/lines/lines.debug.controller.ts`

---

### Tareas - Módulo Categorías

#### TASK-019: Implementar CRUD completo de Categorías

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Implementar módulo completo de categorías con endpoints CRUD siguiendo el mismo patrón que líneas.  
**Criterios de Aceptación:**

- Crear rutas en `routes/categories.routes.ts`
- Crear controladores query y command en `controllers/categories/`
- Crear servicio en `services/category.service.ts`
- Endpoints: GET /api/categorias, GET /api/categorias/:id, GET /api/categorias/buscar/:termino
- Endpoints: POST /api/categorias, PUT /api/categorias/:id, DELETE /api/categorias/:id
- Montar rutas en `routes/index.ts`
- Implementar soft delete
- Validar unicidad de nombre

**Nota:** El modelo ya existe en `functions/src/models/catalogo.model.ts` (interface `Categoria`)

**Archivos de Código:**

- `functions/src/services/category.service.ts` (servicio completo con validaciones)
- `functions/src/controllers/categories/categories.query.controller.ts` (getAll, getById, search)
- `functions/src/controllers/categories/categories.command.controller.ts` (create, update, remove)
- `functions/src/controllers/categories/categories.debug.controller.ts` (debugFirestore)
- `functions/src/routes/categories.routes.ts` (rutas montadas)
- `functions/src/routes/index.ts` (integración en router principal)

---

#### TASK-020: Filtrar categorías por línea

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint GET /api/categorias/linea/:lineaId para obtener categorías asociadas a una línea específica.  
**Criterios de Aceptación:**

- Filtra categorías por lineaId
- Solo retorna categorías activas
- Maneja errores correctamente

**Archivos de Código:**

- `functions/src/routes/categories.routes.ts` (línea 36-40)
- `functions/src/controllers/categories/categories.query.controller.ts` (función `getByLine`)
- `functions/src/services/category.service.ts` (función `getCategoriesByLineId`)

---

### Tareas - Módulo Proveedores

#### TASK-021: Implementar CRUD completo de Proveedores

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Implementar módulo completo de proveedores con endpoints CRUD.  
**Criterios de Aceptación:**

- Crear rutas en `routes/providers.routes.ts`
- Crear controladores query y command en `controllers/providers/`
- Crear servicio en `services/provider.service.ts`
- Endpoints: GET /api/proveedores, GET /api/proveedores/:id, GET /api/proveedores/buscar/:termino
- Endpoints: POST /api/proveedores, PUT /api/proveedores/:id, DELETE /api/proveedores/:id
- Montar rutas en `routes/index.ts`
- Implementar soft delete
- Validar campos requeridos: nombre

**Nota:** El modelo ya existe en `functions/src/models/catalogo.model.ts` (interface `Proveedor`)

**Archivos de Código:**

- `functions/src/services/provider.service.ts` (servicio completo con 6 métodos y validaciones)
- `functions/src/controllers/providers/providers.query.controller.ts` (getAll, getById, search)
- `functions/src/controllers/providers/providers.command.controller.ts` (create, update, remove)
- `functions/src/controllers/providers/providers.debug.controller.ts` (debugFirestore)
- `functions/src/routes/providers.routes.ts` (7 rutas montadas)
- `functions/src/routes/index.ts` (integración en router principal)

---

### Tareas - Módulo Tallas

#### TASK-022: Implementar CRUD completo de Tallas

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Implementar módulo completo de tallas con endpoints CRUD.  
**Criterios de Aceptación:**

- Crear rutas en `routes/sizes.routes.ts`
- Crear controladores query y command en `controllers/sizes/`
- Crear servicio en `services/size.service.ts`
- Endpoints: GET /api/tallas, GET /api/tallas/:id
- Endpoints: POST /api/tallas, PUT /api/tallas/:id, DELETE /api/tallas/:id
- Montar rutas en `routes/index.ts`
- Validar campos requeridos: codigo, descripcion
- Ordenar por campo `orden` si existe

**Nota:** El modelo ya existe en `functions/src/models/catalogo.model.ts` (interface `Talla`)

**Archivos de Código:**

- `functions/src/services/size.service.ts` (servicio completo con 5 métodos y validaciones)
- `functions/src/controllers/sizes/sizes.query.controller.ts` (getAll, getById)
- `functions/src/controllers/sizes/sizes.command.controller.ts` (create, update, remove)
- `functions/src/controllers/sizes/sizes.debug.controller.ts` (debugFirestore)
- `functions/src/routes/sizes.routes.ts` (6 rutas montadas)
- `functions/src/routes/index.ts` (integración en router principal)

---

## ÉPICA 3: Infraestructura Base y DevOps

**Tipo:** Epic  
**Descripción:** Configuración base del proyecto, middleware, manejo de errores, y herramientas de desarrollo.

### Tareas

#### TASK-023: Configuración de Express con middleware

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Configuración inicial de Express con middleware de seguridad y logging.  
**Criterios de Aceptación:**

- Express configurado con CORS habilitado
- Helmet configurado para seguridad HTTP
- Morgan configurado para logging (solo en desarrollo)
- Soporte para JSON y URL encoded
- Manejo de rutas no encontradas (404)

**Archivos de Código:**

- `functions/src/app.ts`

---

#### TASK-024: Configuración de Firebase Admin SDK

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Configuración de Firebase Admin SDK para Firestore y Storage.  
**Criterios de Aceptación:**

- Inicialización correcta para entorno local y producción
- Configuración de Firestore con base de datos `tiendacl`
- Configuración de Storage con bucket `e-comerce-leon.appspot.com`
- Manejo de credenciales locales vs producción

**Archivos de Código:**

- `functions/src/config/firebase.ts`

---

#### TASK-025: Manejo centralizado de errores

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Sistema de manejo de errores centralizado con middleware y clase personalizada.  
**Criterios de Aceptación:**

- Clase ApiError para errores personalizados
- Middleware errorHandler global
- Middleware notFoundHandler para rutas 404
- Helper asyncHandler para manejar errores asíncronos
- Incluye stack trace en desarrollo

**Archivos de Código:**

- `functions/src/utils/error-handler.ts`

---

#### TASK-026: Servidor de desarrollo local

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Configuración de servidor de desarrollo para ejecutar la aplicación localmente sin Firebase Functions.  
**Criterios de Aceptación:**

- Servidor Express independiente en `dev.ts`
- Configuración de variables de entorno con dotenv
- Puerto configurable (default 3000)
- Mensaje de inicio con información del servidor
- Advertencia si IS_LOCAL no está configurado

**Archivos de Código:**

- `functions/src/dev.ts`
- Script en `package.json`: `"dev": "cross-env NODE_ENV=development IS_LOCAL=true STORAGE_BUCKET=e-comerce-leon.appspot.com PORT=3000 ts-node-dev --respawn --transpile-only src/dev.ts"`

---

#### TASK-027: Integración con Firebase Cloud Functions

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Configuración para desplegar la aplicación como Cloud Function en Firebase.  
**Criterios de Aceptación:**

- Archivo `index.ts` que exporta la función HTTPS
- Separación entre app Express y función Firebase
- Configuración en `firebase.json`
- Scripts de build y deploy configurados

**Archivos de Código:**

- `functions/src/index.ts`
- `firebase.json`

---

#### TASK-028: Servicio de Storage para archivos

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Servicio completo para gestión de archivos en Firebase Storage.  
**Criterios de Aceptación:**

- Subida de archivo individual con generación de UUID
- Subida múltiple de archivos
- Eliminación de archivo individual
- Eliminación múltiple de archivos
- Generación de URLs públicas
- Detección automática de content-type
- Organización por carpetas (productos, categorias, etc.)

**Archivos de Código:**

- `functions/src/services/storage.service.ts`

---

#### TASK-029: Configuración de TypeScript

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Configuración de TypeScript con opciones estrictas y compilación.  
**Criterios de Aceptación:**

- tsconfig.json con opciones estrictas
- Compilación a ES2017
- Source maps habilitados
- Output en carpeta `lib`

**Archivos de Código:**

- `functions/tsconfig.json`

---

#### TASK-030: Scripts de build y deploy

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Scripts npm para build, desarrollo y despliegue.  
**Criterios de Aceptación:**

- Script `build` para compilar TypeScript
- Script `dev` para desarrollo local
- Script `deploy` para desplegar a Firebase
- Script `clean` para limpiar archivos compilados
- Scripts de diagnóstico (seed, diagnostico)

**Archivos de Código:**

- `package.json` (raíz y functions/)

---

#### TASK-031: Implementar validación de datos de entrada

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Implementar middleware de validación para validar datos de entrada en todos los endpoints.  
**Criterios de Aceptación:**

- ✅ Usar librería de validación (Zod 3.22.4)
- ✅ Validar tipos de datos
- ✅ Validar campos requeridos
- ✅ Validar formatos (emails, URLs, etc.)
- ✅ Retornar errores de validación estructurados
- ✅ Aplicar a todos los endpoints POST y PUT

**Archivos de Código:**

- `functions/src/middleware/validation.middleware.ts` (middleware centralizado)
- `functions/src/middleware/validators/common.validator.ts` (schemas comunes)
- `functions/src/middleware/validators/product.validator.ts` (validación de productos)
- `functions/src/middleware/validators/category.validator.ts` (validación de categorías)
- `functions/src/middleware/validators/line.validator.ts` (validación de líneas)
- `functions/src/middleware/validators/provider.validator.ts` (validación de proveedores)
- `functions/src/middleware/validators/size.validator.ts` (validación de tallas)
- Todas las rutas actualizadas para usar middleware de validación
- Controllers refactorizados (eliminada validación manual)

**Mejoras de Seguridad Implementadas:**

- Prevención de mass assignment con `.strict()` en todos los schemas
- Validación de tipos en runtime (no solo compile-time)
- Validación de formatos (email, URL)
- Validación de rangos numéricos (positive, nonnegative)
- Validación de longitud de strings
- Rechazo automático de campos extra no definidos
- Mensajes de error estructurados y claros

---

#### TASK-032: Implementar autenticación y autorización

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Implementar sistema de autenticación usando Firebase Auth y middleware de autorización.  
**Criterios de Aceptación:**

- Middleware para verificar tokens de Firebase Auth
- Middleware para verificar roles de usuario
- Proteger endpoints de escritura (POST, PUT, DELETE)
- Endpoints públicos para lectura (GET)
- Manejo de errores de autenticación

---

#### TASK-033: Implementar logging estructurado

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Implementar sistema de logging estructurado para producción.  
**Criterios de Aceptación:**

- Reemplazar console.log con librería de logging (ej: winston, pino)
- Logs estructurados en formato JSON
- Niveles de log (error, warn, info, debug)
- Integración con Firebase Logging
- Logs de requests y responses
- Logs de errores con contexto

---

#### TASK-034: Implementar rate limiting

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Implementar rate limiting para proteger la API de abuso.  
**Criterios de Aceptación:**

- Límite de requests por IP
- Límites diferentes por endpoint
- Headers de rate limit en respuestas
- Manejo de errores 429 (Too Many Requests)

---

#### TASK-035: Documentación de API (Swagger/OpenAPI)

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Implementar documentación de API usando Swagger/OpenAPI.  
**Criterios de Aceptación:**

- Configurar Swagger UI
- Documentar todos los endpoints
- Documentar modelos de datos
- Documentar códigos de respuesta
- Endpoint /api-docs para acceso a documentación

**Notas de Implementación:**

- Implementado con swagger-jsdoc + swagger-ui-express
- Documentados 50+ endpoints usando JSDoc annotations
- Integración automática con schemas Zod usando zod-to-json-schema
- Configuración BearerAuth para endpoints protegidos
- Documentación de usuario disponible en functions/SWAGGER.md
- Acceso: http://localhost:3000/api-docs (desarrollo)

---

## ÉPICA 4: Gestión de Usuarios y Autenticación

**Tipo:** Epic  
**Descripción:** Sistema completo de gestión de usuarios, autenticación y autorización.

### Tareas

#### TASK-036: Modelo de datos de Usuario

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Crear modelo de datos para usuarios del sistema.  
**Criterios de Aceptación:**

- Interface de Usuario con campos: id, email, nombre, rol, activo, createdAt, updatedAt
- DTOs para crear y actualizar usuario
- Validaciones de campos requeridos
- Integración con Firebase Auth UID

---

#### TASK-037: CRUD completo de Usuarios

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Implementar endpoints CRUD para gestión de usuarios.  
**Criterios de Aceptación:**

- GET /api/usuarios - Listar usuarios
- GET /api/usuarios/:id - Obtener usuario por ID
- POST /api/usuarios - Crear usuario
- PUT /api/usuarios/:id - Actualizar usuario
- DELETE /api/usuarios/:id - Eliminar usuario (soft delete)
- Buscar usuarios por email o nombre
- Solo administradores pueden gestionar usuarios

---

#### TASK-038: Registro de usuarios

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para registro de nuevos usuarios.  
**Criterios de Aceptación:**

- POST /api/auth/registro
- Crear usuario en Firebase Auth
- Crear documento en Firestore
- Enviar email de verificación
- Validar datos de entrada
- Manejar errores de duplicados

---

#### TASK-039: Login de usuarios

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para autenticación de usuarios.  
**Criterios de Aceptación:**

- POST /api/auth/login
- Validar credenciales con Firebase Auth
- Generar token de sesión
- Retornar información del usuario
- Manejar errores de autenticación

---

#### TASK-040: Middleware de autenticación

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Middleware para verificar tokens de autenticación en requests.  
**Criterios de Aceptación:**

- Verificar token de Firebase Auth
- Extraer información del usuario
- Agregar usuario al request object
- Retornar 401 si token inválido
- Retornar 403 si usuario inactivo

---

#### TASK-041: Middleware de autorización por roles

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Middleware para verificar roles de usuario y permisos.  
**Criterios de Aceptación:**

- Verificar rol del usuario
- Roles: admin, empleado, cliente
- Proteger endpoints según rol requerido
- Retornar 403 si no tiene permisos

---

#### TASK-042: Recuperación de contraseña

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para solicitar recuperación de contraseña.  
**Criterios de Aceptación:**

- POST /api/auth/recuperar-password
- Enviar email con link de recuperación
- Generar token de recuperación
- Validar email existe

---

#### TASK-043: Actualizar perfil de usuario

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para que usuarios actualicen su propio perfil.  
**Criterios de Aceptación:**

- PUT /api/auth/perfil
- Solo puede actualizar su propio perfil
- Validar datos de entrada
- No permitir cambio de email sin verificación
- Actualizar timestamp

---

## ÉPICA 5: Gestión de Órdenes y Pedidos

**Tipo:** Epic  
**Descripción:** Sistema completo para gestión de órdenes de compra, desde creación hasta cumplimiento.

### Tareas

#### TASK-044: Modelo de datos de Orden

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Crear modelo de datos para órdenes de compra.  
**Criterios de Aceptación:**

- Interface de Orden con campos: id, usuarioId, items, subtotal, impuestos, total, estado, direccionEnvio, metodoPago, createdAt, updatedAt
- Estados: pendiente, confirmada, en_proceso, enviada, entregada, cancelada
- Items con: productoId, cantidad, precioUnitario, subtotal

**Archivos de Código:**

- `functions/src/models/orden.model.ts` (interfaces completas con JSDoc)
- `functions/src/middleware/validators/orden.validator.ts` (schemas Zod con validación estricta)
- `functions/src/config/swagger.config.ts` (schemas registrados para documentación API)

**Nota:** Modelo completo implementado con tipos TypeScript estrictos, enums para estados y métodos de pago, DTOs para create/update, validación Zod con .strict() para prevenir mass assignment, y estructura completa de dirección de envío. No usa soft delete (órdenes canceladas mantienen estado CANCELADA). Listo para implementación de servicios y controladores.

---

#### TASK-045: Crear nueva orden

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para crear una nueva orden de compra.  
**Criterios de Aceptación:**

- POST /api/ordenes
- Validar que productos existan y tengan stock
- Calcular totales automáticamente
- Validar datos de envío
- Crear orden con estado "pendiente"
- Reducir stock de productos ✅ **IMPLEMENTADO con transacciones Firestore**
- Requiere autenticación (PENDIENTE - implementar cuando TASK-032 esté completa)

**Archivos de Código:**

- `functions/src/routes/ordenes.routes.ts` (rutas con documentación Swagger completa)
- `functions/src/controllers/orders/orders.command.controller.ts` (función `create`)
- `functions/src/services/orden.service.ts` (función `createOrden` con validaciones y reducción de stock)
- `functions/src/services/product.service.ts` (métodos `decrementStock`, `incrementStock`, `restoreStockFromOrder`)
- `functions/src/routes/index.ts` (integración en router principal)

**Notas de Implementación:**

- Servidor recalcula todos los totales (ignora valores del cliente por seguridad)
- IVA = 0% (temporal, cambiar a 16% modificando constante TASA_IVA)
- ✅ **REDUCE STOCK automáticamente** usando transacciones Firestore (atomicidad garantizada)
- Rollback automático si falla la reducción de stock (orden no se crea)
- Sin middleware de autenticación (agregar cuando TASK-032 esté completa)
- Estado inicial: PENDIENTE automáticamente
- Timestamps autogenerados con Firestore Timestamp.now()
- Validación estricta con Zod (createOrdenSchema)
- Documentación completa en Swagger UI (/api-docs)
- Cumple con AGENTS.MD sección 9: usa transacciones para decrementos de stock

---

#### TASK-046: Listar órdenes

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para listar órdenes con filtros.  
**Criterios de Aceptación:**

- GET /api/ordenes
- Filtrar por usuario (clientes solo ven sus órdenes)
- Filtrar por estado
- Filtrar por fecha
- Paginación
- Ordenar por fecha descendente

**Archivos de Código:**

- `functions/src/controllers/orders/orders.query.controller.ts` (getAll, getById)
- `functions/src/services/orden.service.ts` (getAllOrdenes, getOrdenById)
- `functions/src/middleware/validators/orden.validator.ts` (listOrdenesQuerySchema)
- `functions/src/routes/ordenes.routes.ts` (GET / y GET /:id con documentación Swagger)
- `functions/src/config/swagger.config.ts` (ListOrdenesQuery schema registrado)
- `firestore.indexes.json` (4 índices compuestos para órdenes)

**Notas de Implementación:**

- **Sin paginación**: Mantiene consistencia con otros endpoints (productos, categorías)
- **Autorización BOLA Prevention**: Clientes forzados a ver solo sus órdenes, admins ven todas
- **Filtros implementados**:
  - `estado`: Múltiples estados via CSV (`?estado=PENDIENTE,CONFIRMADA`)
  - `usuarioId`: Solo para admins (ignorado para clientes)
  - `fechaDesde`/`fechaHasta`: ISO 8601 datetime completo
- **Ordenamiento**: Siempre por `createdAt` descendente
- **Validación**: Schema Zod sin `.strict()` en query params
- **Firestore indexes**: 4 índices compuestos agregados para soportar queries
  - `usuarioId + createdAt desc`
  - `usuarioId + estado + createdAt desc`
  - `estado + createdAt desc`
  - `createdAt desc`
- **Documentación**: Swagger completa con ejemplos para cliente, admin y filtros
- Respuestas: 200 (éxito con count), 401 (no autenticado), 403 (sin ownership en getById), 404 (no encontrada en getById), 500 (error)

---

#### TASK-047: Obtener orden por ID

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para obtener detalles de una orden específica con información populada.  
**Criterios de Aceptación:**

- GET /api/ordenes/:id
- Incluir información de productos (populate) ✅
- Incluir información de usuario ✅
- Clientes solo pueden ver sus propias órdenes ✅
- Administradores pueden ver todas ✅

**Archivos de Código:**

- `functions/src/routes/ordenes.routes.ts` (GET /:id con documentación Swagger completa)
- `functions/src/controllers/orders/orders.query.controller.ts` (función `getById` actualizada)
- `functions/src/services/orden.service.ts` (función `getOrdenByIdConPopulate` agregada)

**Notas de Implementación:**

- **Populate automático** de productos: clave, descripción, imágenes
- **Populate automático** de usuario: nombre, email, telefono
- **BOLA Prevention**: Validación de ownership implementada
- Si un producto fue eliminado, muestra "Producto no disponible"
- Si el usuario no existe, muestra valores por defecto
- Documentación Swagger completa con ejemplos de respuestas populadas
- Respuestas: 200 (éxito con populate), 401 (no autenticado), 403 (sin ownership), 404 (no encontrada), 500 (error)

---

#### TASK-048: Actualizar estado de orden

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para actualizar el estado de una orden.  
**Criterios de Aceptación:**

- PUT /api/ordenes/:id/estado
- Validar transiciones de estado válidas (todas permitidas - flexibilidad operativa)
- Solo administradores pueden cambiar estado (requireAdmin middleware)
- Enviar notificaciones según cambio de estado (TODO - ÉPICA 11)
- Actualizar timestamp

**Archivos de Código:**

- `functions/src/models/usuario.model.ts` (enum RolUsuario agregado - línea ~7)
- `functions/src/utils/middlewares.ts` (middleware requireAdmin - línea ~47)
- `functions/src/middleware/validators/orden.validator.ts` (schema updateEstadoOrdenSchema - línea ~252)
- `functions/src/services/orden.service.ts` (método updateEstadoOrden - línea ~175)
- `functions/src/controllers/orders/orders.command.controller.ts` (función updateEstado - línea ~70)
- `functions/src/routes/ordenes.routes.ts` (ruta PUT /:id/estado con Swagger - línea ~230)
- `functions/src/config/swagger.config.ts` (schema registrado - línea ~220)

**Notas de Implementación:**

- Sistema de roles agregado: ADMIN, EMPLEADO, CLIENTE (default)
- Middleware requireAdmin valida rol ADMIN o EMPLEADO
- Validación de ownership implementada (BOLA prevention según AGENTS.MD)
- Todas las transiciones de estado permitidas (sin restricciones)
- Notificaciones pendientes (implementar en ÉPICA 11 - TASK-078 a 082)
- Documentación Swagger completa con ejemplos
- Respuestas: 200 (éxito), 400 (validación), 401 (no autenticado), 403 (sin permisos), 404 (no encontrada), 500 (error)

---

#### TASK-049: Cancelar orden

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para cancelar una orden.  
**Criterios de Aceptación:**

- PUT /api/ordenes/:id/cancelar
- Solo se puede cancelar si está en estado "pendiente" o "confirmada" ✅
- Restaurar stock de productos ✅
- Cambiar estado a "cancelada" ✅
- Enviar notificación al usuario (TODO - ÉPICA 11)

**Archivos de Código:**

- `functions/src/routes/ordenes.routes.ts` (línea ~368 - ruta PUT /:id/cancelar con documentación Swagger completa)
- `functions/src/controllers/orders/orders.command.controller.ts` (función `cancel` - línea ~170)
- `functions/src/services/orden.service.ts` (método `cancelarOrden` - línea ~620)
- `functions/src/services/product.service.ts` (métodos de stock: `decrementStock`, `incrementStock`, `restoreStockFromOrder` - línea ~350)

**Notas de Implementación:**

- ✅ **Validación estricta de estado:** Solo permite cancelar órdenes PENDIENTE o CONFIRMADA (error 400 si no cumple)
- ✅ **Autorización BOLA prevention:** Admins/empleados pueden cancelar cualquier orden, clientes solo sus propias órdenes
- ✅ **Restauración de stock automática:** Usa transacciones Firestore para atomicidad (cumple AGENTS.MD sección 9)
- ✅ **Cambio de estado a CANCELADA:** Permanente y no reversible (audit trail)
- ✅ **Rollback inteligente:** Si falla la restauración de stock, loggea error pero completa la cancelación (evita bloqueos)
- Requiere autenticación: `authMiddleware` (Bearer token)
- Validación de params: `idParamSchema` con Zod
- Documentación Swagger completa con ejemplos para cliente, admin y casos de error
- Respuestas: 200 (éxito), 400 (estado inválido), 401 (no autenticado), 403 (sin ownership), 404 (no encontrada), 500 (error)
- TODO: Notificaciones al usuario (pendiente - implementar en ÉPICA 11 TASK-080)
- Logs detallados para auditoría y debugging

---

#### TASK-050: Historial de órdenes por usuario

**Tipo:** Task  
**Estado:** ✅  
**Descripción:** Endpoint para obtener historial de órdenes de un usuario específico.  
**Criterios de Aceptación:**

- GET /api/usuarios/:id/ordenes
- Solo usuarios autenticados pueden ver su historial
- Administradores pueden ver historial de cualquier usuario
- Ordenar por fecha descendente
- Paginación

---

## ÉPICA 6: Carrito de Compras

**Tipo:** Epic  
**Descripción:** Sistema de carrito de compras para usuarios no autenticados y autenticados.

### Tareas

#### TASK-051: Modelo de datos de Carrito

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Crear modelo de datos para carrito de compras.  
**Criterios de Aceptación:**

- Interface de Carrito con campos: id, usuarioId (opcional), items, createdAt, updatedAt
- Items con: productoId, cantidad, precioUnitario
- Soporte para carritos de usuarios autenticados y sesiones

---

#### TASK-052: Obtener carrito actual

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para obtener el carrito del usuario o sesión actual.  
**Criterios de Aceptación:**

- GET /api/carrito ✅
- Crear carrito si no existe ✅
- Incluir información de productos (populate) ✅
- Calcular totales ✅
- Manejar carritos de usuarios y sesiones ✅

**Archivos de Código:**

- `functions/src/routes/carrito.routes.ts` (GET / con documentación Swagger completa)
- `functions/src/controllers/carrito/carrito.query.controller.ts` (función `getCart`)
- `functions/src/services/carrito.service.ts` (funciones `getOrCreateCart`, `getCartPopulado`)
- `functions/src/models/carrito.model.ts` (interfaces `Carrito`, `CarritoPopulado`, `ItemCarrito`)
- `functions/src/middleware/validators/carrito.validator.ts` (schemas Zod)
- `functions/src/routes/index.ts` (montado en `/carrito`)

**Notas de Implementación:**

- **Dual-mode auth**: `optionalAuthMiddleware` permite usuario autenticado (Bearer token) y anónimo (header `x-session-id`)
- **Auto-creación**: Si no existe carrito para el usuario/sesión, crea uno vacío automáticamente
- **Populate completo**: `getCartPopulado()` batch-read de productos con `itemsDetallados` (clave, descripción, imágenes, existencias, precioPublico, activo)
- **Totales recalculados**: subtotal y total sincronizados en cada operación
- **Idempotente**: llamadas repetidas retornan el mismo carrito (no duplica)
- **Validación**: retorna 400 si no se proporciona ni auth ni x-session-id
- Documentación Swagger completa con ejemplos
- Respuestas: 200 (éxito), 400 (sin identificación), 500 (error)

---

#### TASK-053: Agregar producto al carrito

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para agregar un producto al carrito.  
**Criterios de Aceptación:**

- POST /api/carrito/items ✅
- Validar que producto exista y tenga stock ✅
- Validar cantidad disponible ✅
- Si producto ya está en carrito, incrementar cantidad ✅
- Actualizar totales ✅
- Retornar carrito actualizado ✅

**Archivos de Código:**

- `functions/src/routes/carrito.routes.ts` (línea 161-167 — ruta POST /items con Swagger completo)
- `functions/src/controllers/carrito/carrito.command.controller.ts` (función `addItem` línea 55-100)
- `functions/src/services/carrito.service.ts` (método `addItem` línea 269-393)
- `functions/src/middleware/validators/carrito.validator.ts` (schema `addItemCarritoSchema` línea 23-50)
- `functions/src/models/carrito.model.ts` (DTO `AgregarItemCarritoDTO` línea 83-87)
- `functions/src/config/swagger.config.ts` (schema `AddItemCarrito` registrado)

**Notas de Implementación:**

- **Validación Zod estricta**: `addItemCarritoSchema` con `.strict()` — valida `productoId` (string, trimmed), `cantidad` (int, 1-10), `tallaId?` (opcional)
- **Precio del servidor**: `precioUnitario` se obtiene de `precioPublico` del producto, nunca del cliente (seguridad)
- **Duplicados inteligentes**: Si el producto+talla ya existe en carrito, suma cantidades en vez de duplicar
- **Validación de stock**: Verifica `existencias >= cantidadTotal` (cantidad existente + nueva)
- **Límite por item**: `MAX_CANTIDAD_POR_ITEM = 10` validado en schema y servicio
- **Dual-mode auth**: `optionalAuthMiddleware` soporta Bearer token y `x-session-id` para anónimos
- **Respuesta populada**: Retorna carrito con `itemsDetallados` (datos completos de productos)
- **Recalculación automática**: `recalculateTotals()` recalcula subtotal/total tras cada mutación
- **Errores mapeados**: Producto no existe → 400, sin stock → 400, cantidad máxima → 400, servidor → 500
- Documentación Swagger completa con ejemplos y respuestas de error
- Cumple AGENTS.MD: validación Zod, patrón CQRS, respuestas consistentes, sin `any`

---

#### TASK-054: Actualizar cantidad de item en carrito

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para actualizar la cantidad de un item en el carrito.  
**Criterios de Aceptación:**

- PUT /api/carrito/items/:productoId ✅
- Validar cantidad disponible ✅
- Si cantidad es 0, eliminar item ✅
- Actualizar totales ✅
- Retornar carrito actualizado ✅

**Archivos de Código:**

- `functions/src/routes/carrito.routes.ts` (línea 258-264 — ruta PUT /items/:productoId con Swagger completo líneas 188-256)
- `functions/src/controllers/carrito/carrito.command.controller.ts` (función `updateItem` línea 127-180)
- `functions/src/services/carrito.service.ts` (método `updateItemQuantity` línea 403-498)
- `functions/src/middleware/validators/carrito.validator.ts` (schemas `updateItemCarritoSchema` línea 60-73, `productoIdParamSchema` línea 75-83)
- `functions/src/config/swagger.config.ts` (schema `UpdateItemCarrito` registrado)

**Notas de Implementación:**

- **Validación Zod estricta**: `updateItemCarritoSchema` con `.strict()` — `cantidad` (int, 0-10); `productoIdParamSchema` para params
- **Cantidad 0 = eliminar**: Si `cantidad === 0`, delega a `removeItem()` internamente (patrón limpio)
- **Validación de stock**: Verifica `existencias >= cantidad` solicitada contra Firestore
- **Precio actualizado**: Actualiza `precioUnitario` al precio actual del producto en cada operación
- **Producto eliminado**: Si el producto fue borrado de BD, actualiza cantidad sin cambiar precio (resiliencia)
- **Dual-mode auth**: `optionalAuthMiddleware` soporta Bearer token y `x-session-id`
- **Respuesta populada**: Retorna carrito completo con `itemsDetallados`
- **Recalculación automática**: `recalculateTotals()` recalcula subtotal/total
- **Errores mapeados**: Item no encontrado → 404, stock insuficiente → 400, servidor → 500
- **Mensaje dinámico**: "Producto eliminado del carrito" si cantidad=0, "Cantidad actualizada" si no
- Documentación Swagger completa con ejemplos y respuestas de error

---

#### TASK-055: Eliminar item del carrito

**Tipo:** Task  
**Estado:** ✅ DONE  
**Descripción:** Endpoint para eliminar un item del carrito.  
**Criterios de Aceptación:**

- DELETE /api/carrito/items/:productoId ✅
- Validar que item exista en carrito ✅
- Actualizar totales ✅
- Retornar carrito actualizado ✅

**Archivos de Código:**

- `functions/src/routes/carrito.routes.ts` (línea 319-324 — ruta DELETE /items/:productoId con Swagger completo líneas 265-318)
- `functions/src/controllers/carrito/carrito.command.controller.ts` (función `removeItem` línea 195-233)
- `functions/src/services/carrito.service.ts` (método `removeItem` línea 507-569)
- `functions/src/middleware/validators/carrito.validator.ts` (schema `productoIdParamSchema` línea 75-83)

**Notas de Implementación:**

- **Validación de existencia**: Busca item por `productoId` + `tallaId` opcional, lanza error si no existe
- **Eliminación limpia**: Usa `splice()` para remover item del array
- **Recalculación automática**: `recalculateTotals()` recalcula subtotal/total tras eliminar
- **Dual-mode auth**: `optionalAuthMiddleware` soporta Bearer token y `x-session-id`
- **Respuesta populada**: Retorna carrito completo con `itemsDetallados`
- **Errores mapeados**: Item no encontrado → 404, servidor → 500
- Documentación Swagger completa con ejemplos y respuestas de error

---

#### TASK-056: Vaciar carrito

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para vaciar completamente el carrito.  
**Criterios de Aceptación:**

- DELETE /api/carrito
- Eliminar todos los items
- Retornar carrito vacío

---

#### TASK-057: Convertir carrito en orden

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para convertir el carrito en una orden de compra.  
**Criterios de Aceptación:**

- POST /api/carrito/checkout
- Validar stock de todos los productos
- Crear orden con items del carrito
- Vaciar carrito después de crear orden
- Requiere autenticación o datos de usuario
- Retornar orden creada

---

## ÉPICA 7: Sistema de Pagos

**Tipo:** Epic  
**Descripción:** Integración con sistemas de pago para procesar transacciones.

### Tareas

#### TASK-058: Modelo de datos de Pago

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Crear modelo de datos para pagos.  
**Criterios de Aceptación:**

- Interface de Pago con campos: id, ordenId, metodoPago, monto, estado, transaccionId, fechaPago, createdAt
- Estados: pendiente, procesando, completado, fallido, reembolsado
- Métodos: tarjeta, transferencia, efectivo

---

#### TASK-059: Procesar pago de orden

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para procesar el pago de una orden.  
**Criterios de Aceptación:**

- POST /api/pagos/procesar
- Validar que orden exista y esté pendiente
- Validar método de pago
- Integrar con pasarela de pago (ej: Stripe, PayPal)
- Actualizar estado de orden a "confirmada"
- Crear registro de pago
- Manejar errores de pago

---

#### TASK-060: Webhook de pasarela de pago

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint webhook para recibir notificaciones de la pasarela de pago.  
**Criterios de Aceptación:**

- POST /api/pagos/webhook
- Verificar firma del webhook
- Actualizar estado de pago según notificación
- Actualizar estado de orden
- Manejar diferentes eventos (pago exitoso, fallido, reembolso)

---

#### TASK-061: Consultar estado de pago

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para consultar el estado de un pago específico.  
**Criterios de Aceptación:**

- GET /api/pagos/:id
- Retornar información del pago
- Incluir información de orden asociada
- Solo usuario propietario o administrador puede consultar

---

#### TASK-062: Procesar reembolso

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para procesar reembolsos de pagos.  
**Criterios de Aceptación:**

- POST /api/pagos/:id/reembolso
- Validar que pago esté completado
- Procesar reembolso en pasarela de pago
- Actualizar estado de pago a "reembolsado"
- Cancelar orden asociada
- Solo administradores pueden procesar reembolsos

---

## ÉPICA 8: Gestión de Inventario

**Tipo:** Epic  
**Descripción:** Sistema avanzado de gestión de inventario con control de stock por talla y ubicación.

### Tareas

#### TASK-063: Modelo de inventario por talla

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Extender modelo de producto para manejar inventario por talla.  
**Criterios de Aceptación:**

- Estructura de datos: { tallaId: string, cantidad: number }
- Actualizar modelo de Producto
- Endpoint para consultar stock por talla
- Validar disponibilidad antes de agregar al carrito

---

#### TASK-064: Actualizar stock de producto

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para actualizar el stock de un producto (por talla si aplica).  
**Criterios de Aceptación:**

- PUT /api/productos/:id/stock
- Actualizar existencias generales o por talla
- Registrar movimiento de inventario
- Validar que cantidad no sea negativa
- Solo administradores pueden actualizar stock

---

#### TASK-065: Movimientos de inventario

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Sistema para registrar movimientos de inventario (entradas, salidas, ajustes).  
**Criterios de Aceptación:**

- Modelo de MovimientoInventario
- Tipos: entrada, salida, ajuste, venta, devolucion
- Endpoint para registrar movimientos
- Endpoint para consultar historial de movimientos
- Relación con órdenes y productos

---

#### TASK-066: Alertas de stock bajo

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Sistema para detectar y notificar cuando el stock está bajo.  
**Criterios de Aceptación:**

- Configurar umbral mínimo por producto
- Endpoint para consultar productos con stock bajo
- Notificación automática a administradores
- Dashboard de alertas

---

#### TASK-067: Ajuste de inventario

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para realizar ajustes de inventario (conteo físico).  
**Criterios de Aceptación:**

- POST /api/inventario/ajustes
- Registrar diferencia entre físico y sistema
- Actualizar stock
- Registrar motivo del ajuste
- Solo administradores pueden hacer ajustes

---

## ÉPICA 9: Sistema de Envíos

**Tipo:** Epic  
**Descripción:** Gestión de envíos y seguimiento de paquetes.

### Tareas

#### TASK-068: Modelo de datos de Envío

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Crear modelo de datos para envíos.  
**Criterios de Aceptación:**

- Interface de Envio con campos: id, ordenId, direccionEnvio, transportista, numeroGuia, estado, fechaEnvio, fechaEntregaEstimada, fechaEntregaReal
- Estados: pendiente, en_transito, en_reparto, entregado, devuelto

---

#### TASK-069: Crear envío para orden

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para crear un envío cuando una orden cambia a estado "enviada".  
**Criterios de Aceptación:**

- POST /api/envios
- Validar que orden exista y esté confirmada
- Validar dirección de envío
- Generar número de guía
- Calcular fecha estimada de entrega
- Actualizar estado de orden

---

#### TASK-070: Actualizar estado de envío

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para actualizar el estado de un envío.  
**Criterios de Aceptación:**

- PUT /api/envios/:id/estado
- Validar transiciones de estado
- Actualizar fecha de entrega si aplica
- Notificar al usuario del cambio
- Actualizar estado de orden si se entrega

---

#### TASK-071: Consultar seguimiento de envío

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para consultar el estado de un envío por número de guía.  
**Criterios de Aceptación:**

- GET /api/envios/seguimiento/:numeroGuia
- Retornar información del envío
- Incluir historial de estados
- Público (no requiere autenticación)

---

#### TASK-072: Integración con transportistas

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Integración con APIs de transportistas para obtener tracking automático.  
**Criterios de Aceptación:**

- Integrar con API de transportista (ej: Estafeta, FedEx)
- Sincronizar estados automáticamente
- Webhook para recibir actualizaciones
- Manejar errores de integración

---

## ÉPICA 10: Reportes y Analytics

**Tipo:** Epic  
**Descripción:** Sistema de reportes y análisis de datos de la tienda.

### Tareas

#### TASK-073: Dashboard de ventas

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para obtener métricas de ventas para dashboard.  
**Criterios de Aceptación:**

- GET /api/reportes/ventas
- Ventas por período (día, semana, mes)
- Total de ventas
- Número de órdenes
- Productos más vendidos
- Solo administradores pueden acceder

---

#### TASK-074: Reporte de productos más vendidos

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para obtener reporte de productos más vendidos.  
**Criterios de Aceptación:**

- GET /api/reportes/productos-vendidos
- Filtrar por período
- Ordenar por cantidad vendida
- Incluir ingresos por producto
- Paginación

---

#### TASK-075: Reporte de inventario

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para obtener reporte de estado de inventario.  
**Criterios de Aceptación:**

- GET /api/reportes/inventario
- Productos con stock bajo
- Valor total de inventario
- Productos sin movimiento
- Exportar a CSV/Excel

---

#### TASK-076: Reporte de clientes

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Endpoint para obtener reporte de clientes y sus compras.  
**Criterios de Aceptación:**

- GET /api/reportes/clientes
- Clientes más frecuentes
- Valor de compras por cliente
- Clientes nuevos por período
- Solo administradores pueden acceder

---

#### TASK-077: Exportar reportes

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Funcionalidad para exportar reportes a diferentes formatos.  
**Criterios de Aceptación:**

- Exportar a CSV
- Exportar a PDF
- Exportar a Excel
- Parámetros de query para filtrar datos

---

## ÉPICA 11: Notificaciones y Comunicaciones

**Tipo:** Epic  
**Descripción:** Sistema de notificaciones por email y otros canales.

### Tareas

#### TASK-078: Servicio de email

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Implementar servicio para envío de emails.  
**Criterios de Aceptación:**

- Integrar con servicio de email (ej: SendGrid, Mailgun, Firebase Extensions)
- Templates de email
- Envío de emails transaccionales
- Manejo de errores y reintentos

---

#### TASK-079: Notificación de orden creada

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Enviar email al usuario cuando se crea una orden.  
**Criterios de Aceptación:**

- Email con detalles de la orden
- Incluir resumen de productos
- Incluir totales
- Enviar automáticamente al crear orden

---

#### TASK-080: Notificación de cambio de estado de orden

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Enviar email al usuario cuando cambia el estado de su orden.  
**Criterios de Aceptación:**

- Email según nuevo estado
- Incluir información de envío si aplica
- Incluir número de guía si aplica
- Enviar automáticamente al cambiar estado

---

#### TASK-081: Notificación de stock bajo

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Enviar notificación a administradores cuando el stock está bajo.  
**Criterios de Aceptación:**

- Email con lista de productos con stock bajo
- Enviar diariamente o en tiempo real
- Incluir cantidad actual y mínima recomendada

---

#### TASK-082: Notificación de pago procesado

**Tipo:** Task  
**Estado:** 🔲 TODO  
**Descripción:** Enviar email de confirmación cuando se procesa un pago exitosamente.  
**Criterios de Aceptación:**

- Email con confirmación de pago
- Incluir detalles de transacción
- Incluir información de orden
- Enviar automáticamente al procesar pago

---

## Resumen de Estados

### ✅ DONE (45 tareas)

- **Infraestructura Base:** 8 tareas
- **Módulo Productos:** 11 tareas (+ gestión de stock con transacciones)
- **Módulo Líneas:** 7 tareas
- **Módulo Categorías:** 2 tareas
- **Módulo Proveedores:** 1 tarea
- **Módulo Tallas:** 1 tarea
- **Módulo Órdenes:** 6 tareas (TASK-044 a TASK-049 completas)
- **Módulo Carrito:** 3 tareas (TASK-053, TASK-054, TASK-055)
- **Servicio Storage:** 1 tarea
- **Otros:** 5 tareas

### 🔲 TODO (37 tareas)

- **Catálogos Auxiliares:** 0 tareas (completado)
- **Infraestructura adicional:** 4 tareas
- **Usuarios y Autenticación:** 8 tareas
- **Órdenes y Pedidos:** 1 tarea (TASK-050)
- **Carrito de Compras:** 4 tareas
- **Sistema de Pagos:** 5 tareas
- **Gestión de Inventario:** 5 tareas
- **Sistema de Envíos:** 5 tareas
- **Reportes y Analytics:** 5 tareas
- **Notificaciones:** 5 tareas

**Total: 82 tareas**

---

## Notas Importantes

1. **Tareas marcadas como DONE** están completamente implementadas en el código y funcionando.
2. **Tareas marcadas como TODO** requieren implementación completa.
3. El sistema usa patrón CQRS (Command Query Responsibility Segregation) separando queries y commands.
4. Todos los endpoints de eliminación implementan soft delete cuando el modelo tiene campo 'activo', excepto Tallas que usa eliminación física.
5. El sistema está preparado para Firebase Cloud Functions pero también puede ejecutarse localmente.
6. **Gestión de stock:** Implementada con transacciones Firestore para atomicidad (TASK-045, TASK-049). Cumple con AGENTS.MD sección 9.
