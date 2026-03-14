export const PRODUCT_TYPE_SYNONYMS: Record<string, string[]> = {
  jersey: [
    "jersey",
    "playera",
    "playeras",
    "camiseta",
    "camisetas",
    "uniforme",
    "uniformes",
    "kit",
    "kits",
    "remera",
    "remeras",
  ],
  playera: ["playera casual", "tee", "shirt"],
  gorra: ["gorra", "gorras", "cap", "cachucha"],
  sudadera: ["sudadera", "hoodie", "sweater"],
  chamarra: ["chamarra", "chaqueta", "jacket"],
  short: ["short", "shorts"],
  pantalon: ["pantalon", "pants", "pants"],
  calcetas: ["calcetas", "calceta", "socks"],
  accesorios: ["accesorio", "accesorios"],
  balon: ["balon", "balones", "pelota"],
};

export const PRODUCT_PROFILE_TERMS: Record<string, string[]> = {
  local: ["local", "de local", "casa", "home"],
  visitante: ["visitante", "de visitante", "away"],
  entrenamiento: ["entrenamiento", "training", "entreno"],
  portero: ["portero", "arquero", "goalkeeper"],
  especial: ["edicion especial", "especial", "conmemorativa", "partido pasado"],
  oficial: ["oficial", "original"],
  replica: ["replica", "version fan"],
  premium: ["premium", "elite"],
  barata: ["barata", "economica", "economico", "mas barata", "buen precio"],
};

export const AUDIENCE_SYNONYMS: Record<string, string[]> = {
  caballero: ["caballero", "hombre", "hombres", "adulto", "adultos", "varon"],
  dama: ["dama", "mujer", "mujeres", "femenil", "femenina"],
  infantil: ["nino", "nina", "ninos", "ninas", "juvenil", "infantil", "kid"],
  bebe: ["bebe", "baby"],
  souvenir: ["souvenir", "regalo", "accesorio"],
};

export const COLOR_SYNONYMS: Record<string, string[]> = {
  verde: ["verde", "verdes", "esmeralda"],
  negro: ["negra", "negras", "negro", "negros", "oscura", "oscuras"],
  blanco: ["blanca", "blancas", "blanco", "blancos"],
  dorado: ["dorada", "doradas", "dorado", "dorados", "oro"],
  amarillo: ["amarilla", "amarillas", "amarillo", "amarillos"],
};

export const SIZE_SYNONYMS: Record<string, string[]> = {
  xs: ["xs", "extra chica", "extra small"],
  s: ["s", "chica", "small"],
  m: ["m", "mediana", "medium"],
  l: ["l", "grande", "large"],
  xl: ["xl", "extra grande", "xg", "extra large"],
  xxl: ["xxl", "2xl", "doble xl"],
  xxxl: ["xxxl", "3xl", "triple xl"],
  ch: ["ch", "chico nino", "nino chico"],
  med: ["med", "mediano nino", "nino mediano"],
  gde: ["gde", "grande nino", "nino grande"],
};

export const REFERENCE_TERMS = {
  recentProduct: ["esa", "ese", "esta", "este", "la otra", "el otro", "esa de la imagen"],
  listPosition: ["la primera", "la segunda", "la tercera"],
  priceSuperlative: ["la mas barata", "la mas economica"],
} as const;

export const POLICY_TOPICS: Record<string, string[]> = {
  shipping: ["envio", "envios", "llega", "entrega", "shipping"],
  returns: ["cambio", "cambios", "devolucion", "devoluciones", "garantia"],
  payments: ["pago", "pagos", "tarjeta", "paypal", "mercadopago", "transferencia"],
  tracking: ["rastreo", "rastrear", "pedido", "orden", "guia", "seguimiento"],
  promotions: ["promocion", "promociones", "descuento", "descuentos", "oferta", "ofertas"],
  store: ["tienda", "ubicacion", "direccion", "horario", "sucursal", "maps"],
};

export const normalizeLexiconTerm = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
