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
import usersRoutes from "./users.routes";
import authRoutes from "./auth.routes";

const router = Router();

// ===================================
// Montaje de Rutas por Módulo
// ===================================

router.use("/productos", productsRoutes);
router.use("/lineas", linesRoutes);
router.use("/categorias", categoriesRoutes);
router.use("/usuarios", usersRoutes);
router.use("/auth", authRoutes);

// Futuros módulos:
// router.use('/usuarios', usersRoutes);
// router.use('/ordenes', ordersRoutes);

export default router;
