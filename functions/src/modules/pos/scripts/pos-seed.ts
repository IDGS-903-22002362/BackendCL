/**
 * Seed idempotente para emulador / desarrollo local del POS.
 *
 * No usa datos personales reales ni credenciales. Idempotente por IDs fijos.
 *
 * Uso:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run pos:seed:emulator
 */

import { firestoreApp } from "../../../config/app.firebase";
import { firestoreTienda } from "../../../config/firebase";
import { FieldValue } from "firebase-admin/firestore";
import {
  POS_COLLECTIONS,
  POS_STORE_ID,
  SHARED_COLLECTIONS,
} from "../constants/pos.constants";
import { PosRegisterStatus, PosRole } from "../models/pos.enums";
import { buildDefaultSettings } from "../services/pos-settings.service";
import { nowTimestamp } from "../repositories/pos-firestore";

const SEED_USERS = [
  {
    uid: "pos-seed-cashier",
    email: "cajero.seed@example.local",
    nombre: "Cajero Seed",
    rol: "EMPLEADO",
    posRole: PosRole.CASHIER,
  },
  {
    uid: "pos-seed-senior",
    email: "senior.seed@example.local",
    nombre: "Senior Seed",
    rol: "EMPLEADO",
    posRole: PosRole.SENIOR_CASHIER,
  },
  {
    uid: "pos-seed-supervisor",
    email: "supervisor.seed@example.local",
    nombre: "Supervisor Seed",
    rol: "EMPLEADO",
    posRole: PosRole.SUPERVISOR,
  },
  {
    uid: "pos-seed-admin",
    email: "admin.seed@example.local",
    nombre: "Admin Seed",
    rol: "ADMIN",
    posRole: null as PosRole | null,
  },
] as const;

const SEED_REGISTERS = [
  { id: "pos-seed-reg-01", code: "C01", name: "Caja 01" },
  { id: "pos-seed-reg-02", code: "C02", name: "Caja 02" },
  { id: "pos-seed-reg-03", code: "C03", name: "Caja 03" },
  { id: "pos-seed-reg-mobile", code: "MOB", name: "Caja móvil" },
] as const;

const SEED_PRODUCTS = [
  {
    id: "pos-seed-prod-jersey",
    clave: "SEED-JERSEY",
    descripcion: "Jersey seed local",
    precioPublico: 1499,
    fisica: 20,
  },
  {
    id: "pos-seed-prod-playera",
    clave: "SEED-PLY",
    descripcion: "Playera seed",
    precioPublico: 499,
    sizes: [
      { tallaId: "seed-talla-m", cantidad: 8 },
      { tallaId: "seed-talla-g", cantidad: 5 },
    ],
  },
] as const;

async function upsertUser(user: (typeof SEED_USERS)[number]): Promise<void> {
  const ref = firestoreApp.collection("usuariosApp").doc(user.uid);
  await ref.set(
    {
      uid: user.uid,
      email: user.email,
      nombre: user.nombre,
      rol: user.rol,
      activo: true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (user.posRole) {
    await firestoreTienda
      .collection(POS_COLLECTIONS.OPERATORS)
      .doc(user.uid)
      .set(
        {
          uid: user.uid,
          posRole: user.posRole,
          active: true,
          defaultRegisterId: null,
          updatedBy: "system:seed",
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
  }
}

async function ensureSettings(): Promise<void> {
  const ref = firestoreTienda
    .collection(POS_COLLECTIONS.SETTINGS)
    .doc(POS_STORE_ID);
  const existing = await ref.get();
  if (existing.exists) {
    return;
  }
  await ref.set(buildDefaultSettings("system:seed"));
}

async function ensureRegisters(): Promise<void> {
  for (const register of SEED_REGISTERS) {
    const ref = firestoreTienda
      .collection(POS_COLLECTIONS.REGISTERS)
      .doc(register.id);
    const existing = await ref.get();
    if (existing.exists) {
      continue;
    }
    await ref.set({
      id: register.id,
      storeId: POS_STORE_ID,
      code: register.code,
      name: register.name,
      status: PosRegisterStatus.AVAILABLE,
      archived: false,
      activeSessionId: null,
      currentShiftId: null,
      currentCashierUid: null,
      config: {
        deviceId: null,
        printerId: null,
        terminalId: null,
        allowCash: true,
        allowCardExternal: true,
      },
      lastActivityAt: null,
      version: 1,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      createdBy: "system:seed",
      updatedBy: "system:seed",
    });
  }
}

async function ensureProducts(): Promise<void> {
  for (const product of SEED_PRODUCTS) {
    const ref = firestoreTienda
      .collection(SHARED_COLLECTIONS.PRODUCTS)
      .doc(product.id);
    const sizes = "sizes" in product ? product.sizes : undefined;
    const fisica = "fisica" in product ? product.fisica : undefined;
    await ref.set(
      {
        clave: product.clave,
        descripcion: product.descripcion,
        precioPublico: product.precioPublico,
        activo: true,
        inventarioGlobal: sizes
          ? undefined
          : {
              fisica: fisica ?? 0,
              reservada: 0,
              noDisponible: 0,
            },
        inventarioPorTalla: sizes
          ? sizes.map((size) => ({
              tallaId: size.tallaId,
              fisica: size.cantidad,
              reservada: 0,
              noDisponible: 0,
            }))
          : [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await firestoreTienda
    .collection("ofertas")
    .doc("pos-seed-offer")
    .set(
      {
        nombre: "Seed oferta 10%",
        tipo: "porcentaje",
        valor: 10,
        activa: true,
        prioridad: 1,
        vigenciaInicio: new Date(Date.now() - 86_400_000).toISOString(),
        vigenciaFin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        alcance: { tipo: "producto", ids: ["pos-seed-prod-jersey"] },
      },
      { merge: true },
    );
}

async function main(): Promise<void> {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.POS_SEED_ALLOW_NON_EMULATOR !== "true"
  ) {
    throw new Error(
      "Seed bloqueado fuera del emulador. Define FIRESTORE_EMULATOR_HOST o POS_SEED_ALLOW_NON_EMULATOR=true.",
    );
  }

  console.log("\nPOS seed (idempotente)");
  await ensureSettings();
  for (const user of SEED_USERS) {
    await upsertUser(user);
  }
  await ensureRegisters();
  await ensureProducts();
  console.log(
    JSON.stringify(
      {
        storeId: POS_STORE_ID,
        users: SEED_USERS.map((user) => user.uid),
        registers: SEED_REGISTERS.map((register) => register.id),
        products: SEED_PRODUCTS.map((product) => product.id),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
