/**
 * Script de Seeds para inicializar Firestore
 * Crea las colecciones y datos iniciales para la tienda del Club León
 *
 * Ejecutar con: npm run se
 */

import * as dotenv from "dotenv";
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";

// Cargar variables de entorno
dotenv.config();

/**
 * Colores para la consola
 */
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  red: "\x1b[31m",
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) =>
    console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg: string) =>
    console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
};

/**
 * Función principal de seed
 */
async function seed() {
  try {
    console.log("\n🌱 Iniciando seed de la base de datos...\n");

    // 1. Seed de Líneas
    await seedLineas();

    // 2. Seed de Categorías
    await seedCategorias();

    // 3. Seed de Tallas
    await seedTallas();

    // 4. Seed de Proveedores
    await seedProveedores();

    // 5. Seed de Ubicaciones
    await seedUbicaciones();

    // 6. Seed de Productos
    await seedProductos();

    // 7. Seed de Configuración
    await seedConfiguracion();

    // 8. Seed de conocimiento AI
    await seedAiKnowledge();

    console.log("\n🎉 Seed completado exitosamente!\n");
    process.exit(0);
  } catch (error) {
    log.error("Error durante el seed:");
    console.error(error);
    process.exit(1);
  }
}

/**
 * Seed de Líneas de productos
 */
async function seedLineas() {
  log.info("Creando líneas de productos...");

  const lineas = [
    { id: "caballero", codigo: 1, nombre: "Caballero" },
    { id: "dama", codigo: 2, nombre: "Dama" },
    { id: "infantil", codigo: 3, nombre: "Infantil" },
    { id: "bebe", codigo: 4, nombre: "Bebé" },
    { id: "souvenir", codigo: 5, nombre: "Souvenir" },
  ];

  const batch = firestoreTienda.batch();

  for (const linea of lineas) {
    const { id, ...data } = linea;
    const ref = firestoreTienda.collection("lineas").doc(id);
    batch.set(ref, data);
  }

  await batch.commit();
  log.success(`${lineas.length} líneas creadas`);
}

/**
 * Seed de Categorías
 */
async function seedCategorias() {
  log.info("Creando categorías...");

  const categorias = [
    { id: "playera", nombre: "Playera", orden: 1 },
    { id: "jersey", nombre: "Jersey Oficial", lineaId: "caballero", orden: 2 },
    { id: "gorra", nombre: "Gorra", orden: 3 },
    { id: "sudadera", nombre: "Sudadera", orden: 4 },
    { id: "chamarra", nombre: "Chamarra", orden: 5 },
    { id: "short", nombre: "Short", orden: 6 },
    { id: "pantalon", nombre: "Pantalón", orden: 7 },
    { id: "calcetas", nombre: "Calcetas", orden: 8 },
    { id: "accesorios", nombre: "Accesorios", lineaId: "souvenir", orden: 9 },
    { id: "balon", nombre: "Balón", lineaId: "souvenir", orden: 10 },
  ];

  const batch = firestoreTienda.batch();

  for (const categoria of categorias) {
    const { id, ...data } = categoria;
    const ref = firestoreTienda.collection("categorias").doc(id);
    batch.set(ref, data);
  }

  await batch.commit();
  log.success(`${categorias.length} categorías creadas`);
}

/**
 * Seed de Tallas
 */
async function seedTallas() {
  log.info("Creando tallas...");

  const tallas = [
    { id: "xs", codigo: "XS", descripcion: "Extra Chica", orden: 1 },
    { id: "s", codigo: "S", descripcion: "Chica", orden: 2 },
    { id: "m", codigo: "M", descripcion: "Mediana", orden: 3 },
    { id: "l", codigo: "L", descripcion: "Grande", orden: 4 },
    { id: "xl", codigo: "XL", descripcion: "Extra Grande", orden: 5 },
    { id: "xxl", codigo: "XXL", descripcion: "2XL", orden: 6 },
    { id: "xxxl", codigo: "XXXL", descripcion: "3XL", orden: 7 },
    { id: "ch", codigo: "CH", descripcion: "Chico (Niño)", orden: 8 },
    { id: "med", codigo: "MED", descripcion: "Mediano (Niño)", orden: 9 },
    { id: "gde", codigo: "GDE", descripcion: "Grande (Niño)", orden: 10 },
  ];

  const batch = firestoreTienda.batch();

  for (const talla of tallas) {
    const { id, ...data } = talla;
    const ref = firestoreTienda.collection("tallas").doc(id);
    batch.set(ref, data);
  }

  await batch.commit();
  log.success(`${tallas.length} tallas creadas`);
}

/**
 * Seed de Proveedores
 */
async function seedProveedores() {
  log.info("Creando proveedores...");

  const proveedores = [
    {
      nombre: "Pirma Sport",
      contacto: "Juan Pérez",
      telefono: "477-123-4567",
      email: "ventas@pirma.com.mx",
      direccion: "León, Guanajuato",
      activo: true,
      notas: "Proveedor oficial de uniformes",
    },
    {
      nombre: "Textiles del Bajío",
      contacto: "María González",
      telefono: "477-987-6543",
      email: "contacto@textilesb.com",
      direccion: "León, Guanajuato",
      activo: true,
      notas: "Textiles y productos promocionales",
    },
    {
      nombre: "Souvenirs León SA",
      contacto: "Carlos Ramírez",
      telefono: "477-555-0123",
      email: "info@souvenirsleon.com",
      direccion: "León, Guanajuato",
      activo: true,
      notas: "Accesorios y souvenirs",
    },
  ];

  const promises = proveedores.map((proveedor) =>
    firestoreTienda.collection("proveedores").add(proveedor)
  );

  await Promise.all(promises);
  log.success(`${proveedores.length} proveedores creados`);
}

/**
 * Seed de Ubicaciones
 */
async function seedUbicaciones() {
  log.info("Creando ubicaciones...");

  const ubicaciones = [
    {
      id: "tienda_estadio",
      nombre: "Tienda Estadio León",
      tipo: "tienda",
      direccion: "Estadio León, Boulevard Adolfo López Mateos 1810",
      responsable: "Ana Martínez",
      activo: true,
      orden: 1,
    },
    {
      id: "almacen_central",
      nombre: "Almacén Central",
      tipo: "almacen",
      direccion: "Bodega Central, León GTO",
      responsable: "Roberto Sánchez",
      activo: true,
      orden: 2,
    },
    {
      id: "comedor",
      nombre: "Comedor del Club",
      tipo: "comedor",
      direccion: "Instalaciones del Club León",
      responsable: "Laura Jiménez",
      activo: true,
      orden: 3,
    },
    {
      id: "tienda_plaza",
      nombre: "Tienda Plaza Mayor",
      tipo: "tienda",
      direccion: "Plaza Mayor, León GTO",
      responsable: "Miguel Torres",
      activo: true,
      orden: 4,
    },
  ];

  const batch = firestoreTienda.batch();

  for (const ubicacion of ubicaciones) {
    const { id, ...data } = ubicacion;
    const ref = firestoreTienda.collection("ubicaciones").doc(id);
    batch.set(ref, data);
  }

  await batch.commit();
  log.success(`${ubicaciones.length} ubicaciones creadas`);
}

/**
 * Seed de Productos
 */
async function seedProductos() {
  log.info("Creando productos de ejemplo...");

  // Obtener IDs de proveedores
  const proveedoresSnapshot = await firestoreTienda
    .collection("proveedores")
    .limit(1)
    .get();
  const proveedorId = proveedoresSnapshot.docs[0]?.id || "proveedor_default";

  const productos = [
    {
      clave: "JER-CAB-2024-L",
      descripcion: "Jersey Oficial Club León 2024 Local",
      lineaId: "caballero",
      categoriaId: "jersey",
      precioPublico: 1299.0,
      precioCompra: 650.0,
      existencias: 50,
      proveedorId: proveedorId,
      tallaIds: ["s", "m", "l", "xl", "xxl"],
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 10 },
        { tallaId: "m", cantidad: 12 },
        { tallaId: "l", cantidad: 10 },
        { tallaId: "xl", cantidad: 9 },
        { tallaId: "xxl", cantidad: 9 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/jersey-local-2024.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "JER-CAB-2024-V",
      descripcion: "Jersey Oficial Club León 2024 Visitante",
      lineaId: "caballero",
      categoriaId: "jersey",
      precioPublico: 1299.0,
      precioCompra: 650.0,
      existencias: 45,
      proveedorId: proveedorId,
      tallaIds: ["s", "m", "l", "xl", "xxl"],
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 9 },
        { tallaId: "m", cantidad: 10 },
        { tallaId: "l", cantidad: 9 },
        { tallaId: "xl", cantidad: 9 },
        { tallaId: "xxl", cantidad: 8 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/jersey-visitante-2024.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "PLAY-CAB-VERDE",
      descripcion: "Playera Casual Verde Esmeralda",
      lineaId: "caballero",
      categoriaId: "playera",
      precioPublico: 449.0,
      precioCompra: 225.0,
      existencias: 80,
      proveedorId: proveedorId,
      tallaIds: ["s", "m", "l", "xl"],
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 20 },
        { tallaId: "m", cantidad: 22 },
        { tallaId: "l", cantidad: 20 },
        { tallaId: "xl", cantidad: 18 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/playera-verde.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "PLAY-DAMA-BLANCA",
      descripcion: "Playera Casual Dama Blanca",
      lineaId: "dama",
      categoriaId: "playera",
      precioPublico: 449.0,
      precioCompra: 225.0,
      existencias: 60,
      proveedorId: proveedorId,
      tallaIds: ["xs", "s", "m", "l"],
      inventarioPorTalla: [
        { tallaId: "xs", cantidad: 15 },
        { tallaId: "s", cantidad: 15 },
        { tallaId: "m", cantidad: 15 },
        { tallaId: "l", cantidad: 15 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/playera-dama.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "GORRA-VERDE-001",
      descripcion: "Gorra Oficial Verde con Logo Bordado",
      lineaId: "souvenir",
      categoriaId: "gorra",
      precioPublico: 349.0,
      precioCompra: 175.0,
      existencias: 100,
      proveedorId: proveedorId,
      tallaIds: [],
      inventarioPorTalla: [],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/gorra-verde.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "SUD-CAB-NEGRA",
      descripcion: "Sudadera con Capucha Negra",
      lineaId: "caballero",
      categoriaId: "sudadera",
      precioPublico: 899.0,
      precioCompra: 450.0,
      existencias: 35,
      proveedorId: proveedorId,
      tallaIds: ["s", "m", "l", "xl", "xxl"],
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 7 },
        { tallaId: "m", cantidad: 8 },
        { tallaId: "l", cantidad: 8 },
        { tallaId: "xl", cantidad: 6 },
        { tallaId: "xxl", cantidad: 6 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/sudadera-negra.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "BALON-OFICIAL-2024",
      descripcion: "Balón Oficial Club León 2024",
      lineaId: "souvenir",
      categoriaId: "balon",
      precioPublico: 649.0,
      precioCompra: 325.0,
      existencias: 25,
      proveedorId: proveedorId,
      tallaIds: [],
      inventarioPorTalla: [],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/balon-oficial.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    {
      clave: "PLAY-INF-VERDE",
      descripcion: "Playera Infantil Verde",
      lineaId: "infantil",
      categoriaId: "playera",
      precioPublico: 349.0,
      precioCompra: 175.0,
      existencias: 55,
      proveedorId: proveedorId,
      tallaIds: ["ch", "med", "gde"],
      inventarioPorTalla: [
        { tallaId: "ch", cantidad: 18 },
        { tallaId: "med", cantidad: 19 },
        { tallaId: "gde", cantidad: 18 },
      ],
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/ejemplo/playera-infantil.jpg",
      ],
      activo: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
  ];

  const promises = productos.map((producto) =>
    firestoreTienda.collection("productos").add(producto)
  );

  await Promise.all(promises);
  log.success(`${productos.length} productos creados`);
}

/**
 * Seed de Configuración
 */
async function seedConfiguracion() {
  log.info("Creando configuración del sistema...");

  // Configuración de puntos
  const configPuntos = {
    puntosPorPesoTienda: 1, // 1 punto por cada $10 pesos
    puntosPorPesoComedor: 2, // 2 puntos por cada $10 pesos en comedor
    valorPuntoEnPesos: 1, // 1 punto = $1 peso
    puntosMinimoCanje: 100, // Mínimo 100 puntos para canjear
    diasExpiracionPuntos: 365, // Los puntos expiran en 1 año
    activo: true,
    actualizadoAt: admin.firestore.Timestamp.now(),
  };

  await firestoreTienda.collection("configuracion").doc("puntos").set(configPuntos);

  // Configuración de la tienda
  const configTienda = {
    nombreTienda: "Tienda Oficial Club León",
    horarioAtencion: "Lunes a Domingo 10:00 - 20:00 hrs",
    telefonoContacto: "477-710-0100",
    emailContacto: "tienda@clubleon.mx",
    permitirComprasSinStock: false,
    diasMaximosDevolucion: 30,
    iva: 0.16,
    costoEnvio: 150,
    envioGratisMinimo: 1000,
    activo: true,
  };

  await firestoreTienda.collection("configuracion").doc("tienda").set(configTienda);

  log.success("Configuración del sistema creada");
}

async function seedAiKnowledge() {
  log.info("Creando conocimiento base para AI...");

  const now = admin.firestore.Timestamp.now();
  const faqEntries = [
    {
      id: "faq_envios",
      question: "¿Cuanto tarda en llegar mi pedido?",
      answer:
        "Los tiempos de entrega dependen de la zona, pero normalmente procesamos y enviamos entre 2 y 5 dias habiles. Si hay envio gratis o promocion, se indicara en el checkout.",
      tags: ["envio", "entrega", "pedido", "llega"],
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "faq_tallas",
      question: "¿Como elijo mi talla?",
      answer:
        "Si buscas jersey oficial, te recomendamos revisar la guia de tallas y, si dudas entre dos medidas, elegir la mas comoda para el uso que le daras.",
      tags: ["talla", "medidas", "jersey", "guia"],
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "faq_cambios",
      question: "¿Aceptan cambios?",
      answer:
        "Si, aceptamos cambios dentro del plazo vigente siempre que el producto este en buen estado y conserve etiquetas. Aplican restricciones en productos personalizados.",
      tags: ["cambios", "devoluciones", "garantia"],
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const policyEntries = [
    {
      id: "envios",
      title: "Politica de envios",
      body:
        "Procesamos pedidos de lunes a viernes. El costo base de envio es de $150 MXN y el envio gratis aplica a partir de $1000 MXN salvo promociones especiales.",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "devoluciones",
      title: "Politica de cambios y devoluciones",
      body:
        "Aceptamos cambios y devoluciones hasta por 30 dias con ticket o comprobante. No aplican devoluciones en productos personalizados o usados.",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const knowledgeEntries = [
    {
      id: "store_info",
      title: "Informacion de tienda fisica",
      body:
        "La tienda oficial del Club Leon atiende todos los dias y puede compartirse la ubicacion oficial por Google Maps.",
      tags: ["tienda", "ubicacion", "maps", "horario"],
      type: "store_info",
      active: true,
      metadata: {
        mapsUrl: "https://maps.app.goo.gl/nnLL1SCpgJo5aqVR6",
        storeName: "Tienda Oficial Club Leon",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "guia_tallas",
      title: "Guia de tallas",
      body:
        "Adulto: XS a XXL. Infantil: CH, MED y GDE. Si el usuario pide mediana, equivale a M; grande equivale a L; chica equivale a S.",
      tags: ["talla", "guia", "medidas", "m", "l", "s"],
      type: "guide",
      active: true,
      metadata: {
        adultSizes: ["xs", "s", "m", "l", "xl", "xxl"],
        kidsSizes: ["ch", "med", "gde"],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "catalog_aliases",
      title: "Alias conversacionales del catalogo",
      body:
        "playera, jersey, camiseta y remera se interpretan como jerseys o playeras segun el contexto. local, visitante, portero y entrenamiento deben usarse como pistas comerciales.",
      tags: ["alias", "catalogo", "jersey", "playera", "local", "visitante", "portero"],
      type: "catalog_aliases",
      active: true,
      metadata: {
        aliases: {
          jersey: ["playera", "camiseta", "remera", "uniforme"],
          local: ["de local", "home"],
          visitante: ["de visitante", "away"],
          portero: ["arquero", "goalkeeper"],
          entrenamiento: ["training", "entreno"],
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "restricciones",
      title: "Restricciones operativas del asistente",
      body:
        "El asistente no debe inventar stock, precios, promociones, pedidos o politicas. Si no hay datos suficientes, debe pedir una aclaracion breve o decir que no puede confirmarlo.",
      tags: ["restricciones", "seguridad", "hallucination"],
      type: "restriction",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const promotionEntries = [
    {
      id: "promo_envio_gratis",
      title: "Envio gratis en compras mayores a $1000",
      description:
        "Las compras superiores a $1000 MXN reciben envio gratis automaticamente.",
      active: true,
      tags: ["envio", "gratis", "promocion"],
      metadata: {
        threshold: 1000,
      },
      createdAt: now,
      updatedAt: now,
    },
  ];

  const batch = firestoreTienda.batch();

  for (const faq of faqEntries) {
    batch.set(firestoreTienda.collection("faqTienda").doc(faq.id), faq);
  }

  for (const policy of policyEntries) {
    batch.set(firestoreTienda.collection("politicasTienda").doc(policy.id), policy);
  }

  for (const knowledge of knowledgeEntries) {
    batch.set(firestoreTienda.collection("knowledgeTienda").doc(knowledge.id), knowledge);
  }

  for (const promotion of promotionEntries) {
    batch.set(firestoreTienda.collection("promocionesTienda").doc(promotion.id), promotion);
  }

  await batch.commit();
  log.success("Conocimiento base AI creado");
}

// Ejecutar seed
seed();
