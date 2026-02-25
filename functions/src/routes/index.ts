/**
 * RUTAS PRINCIPALES DEL API
 * ---------------------------------------------------------------------
 * Este archivo actúa como el "Hub Central" de rutas (Pattern: Barrel/Router).
 * Su responsabilidad es agrupar todos los módulos de rutas del sistema
 * y exponerlos como un único router unificado.
 *
 * PARA AGREGAR UN NUEVO MÓDULO:
 * 1. Importa el archivo de rutas (ej: import usersRoutes from './users.routes')
 * 2. Monta la ruta en el router (ej: router.use('/usuarios', usersRoutes))
 */

import { Router } from "express";
import productsRoutes from "./products.routes";
import linesRoutes from "./lines.routes";
import categoriesRoutes from "./categories.routes";
import providersRoutes from "./providers.routes";
import sizesRoutes from "./sizes.routes";
import usersRoutes from "./users.routes";
import authRoutes from "./auth.routes";
import ordenesRoutes from "./ordenes.routes";
import newsRoutes from "./news.routes";
import carritoRoutes from "./carrito.routes";
import pagosRoutes from "./pagos.routes";
import inventoryRoutes from "./inventory.routes";
import plantillaRoutes from "./plantilla.routes";

const router = Router();

// ===================================
// Montaje de Rutas por Módulo
// ===================================

router.use("/productos", productsRoutes);
router.use("/lineas", linesRoutes);
router.use("/categorias", categoriesRoutes);
router.use("/proveedores", providersRoutes);
router.use("/tallas", sizesRoutes);
router.use("/usuarios", usersRoutes);
router.use("/noticias", newsRoutes);
router.use("/auth", authRoutes);
router.use("/ordenes", ordenesRoutes);
router.use("/carrito", carritoRoutes);
router.use("/pagos", pagosRoutes);
router.use("/inventario", inventoryRoutes);
router.use("/plantilla", plantillaRoutes);

// Futuros módulos:

export default router;
