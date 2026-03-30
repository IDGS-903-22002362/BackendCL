import { QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { configuracionExpiracionPuntos } from "../config/puntos-expiracion.config";
import {
  HistorialPuntosUsuario,
  MovimientoPuntos,
  OrigenPuntos,
  ResumenPuntosAnual,
  TipoMovimientoPuntos,
  UsuarioApp,
} from "../models/usuario.model";
import {
  aplicarMovimientoAResumen,
  calcularCiclosCompletados,
  construirResumenPuntosAnual,
  obtenerCicloActual,
  obtenerCicloPorNumero,
} from "./puntos-expiracion.utils";

const USUARIOS_COLLECTION = "usuariosApp";
const CONFIGURACION_COLLECTION = "configuracion";
const CONFIGURACION_PUNTOS_DOC = "puntos";
const MOVIMIENTOS_PUNTOS_SUBCOLECCION = "movimientos_puntos";
const HISTORIAL_PUNTOS_SUBCOLECCION = "historial_puntos_anual";

interface RegistrarMovimientoOptions {
  tipo: TipoMovimientoPuntos;
  origen: OrigenPuntos;
  origenId?: string;
  referencia?: string;
  descripcion?: string;
}

interface AddPointsOptions extends Partial<RegistrarMovimientoOptions> {}

interface ResumenExpiracionVencida {
  usuariosRevisados: number;
  usuariosProcesados: number;
  ciclosProcesados: number;
  puntosExpirados: number;
}

interface ResultadoExpiracionUsuario {
  procesado: boolean;
  usuarioId: string;
  ciclosProcesados: number;
  puntosExpirados: number;
}

interface VistaPuntosUsuario {
  usuario: UsuarioApp;
  historial: HistorialPuntosUsuario;
  movimientosRecientes: MovimientoPuntos[];
}

class PointsService {
  async addPoints(
    uid: string,
    points: number,
    options: AddPointsOptions = {},
  ): Promise<UsuarioApp> {
    return this.registrarMovimiento(uid, points, {
      tipo: options.tipo ?? TipoMovimientoPuntos.ACUMULACION,
      origen: options.origen ?? "promo",
      origenId: options.origenId,
      referencia: options.referencia,
      descripcion: options.descripcion,
    });
  }

  async obtenerVistaPuntosUsuario(
    uid: string,
    limiteMovimientos = 20,
  ): Promise<VistaPuntosUsuario> {
    const diasExpiracion = await this.obtenerDiasExpiracionPuntos();
    await this.procesarExpiracionUsuario(uid, diasExpiracion);

    const userRef = firestoreApp.collection(USUARIOS_COLLECTION).doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new Error("Usuario no encontrado");
    }

    const userData = userSnap.data() as UsuarioApp;
    if (!userData.createdAt) {
      throw new Error("El usuario no tiene fecha de registro");
    }

    const now = admin.firestore.Timestamp.now();
    const cicloActual = obtenerCicloActual(
      userData.createdAt.toDate(),
      now.toDate(),
      diasExpiracion,
    );
    const historial = this.normalizarHistorialUsuario(
      userData.historialPuntos,
      cicloActual.numero,
      cicloActual.fechaFinProgramada,
    );

    const movimientosSnap = await userRef
      .collection(MOVIMIENTOS_PUNTOS_SUBCOLECCION)
      .orderBy("createdAt", "desc")
      .limit(limiteMovimientos)
      .get();

    const movimientosRecientes = movimientosSnap.docs.map((doc) => {
      return { id: doc.id, ...(doc.data() as MovimientoPuntos) };
    });

    return {
      usuario: { id: userSnap.id, ...userData, historialPuntos: historial },
      historial,
      movimientosRecientes,
    };
  }

  async procesarExpiracionesVencidas(): Promise<ResumenExpiracionVencida> {
    const diasExpiracion = await this.obtenerDiasExpiracionPuntos();
    const pageSize = 200;
    const now = Timestamp.now();
    const cutoff = Timestamp.fromDate(
      new Date(now.toDate().getTime() - diasExpiracion * 24 * 60 * 60 * 1000),
    );
    let lastDoc: QueryDocumentSnapshot | null = null;

    const resumen: ResumenExpiracionVencida = {
      usuariosRevisados: 0,
      usuariosProcesados: 0,
      ciclosProcesados: 0,
      puntosExpirados: 0,
    };

    while (true) {
      let query = firestoreApp
        .collection(USUARIOS_COLLECTION)
        .where("createdAt", "<=", cutoff)
        .orderBy("createdAt")
        .limit(pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        break;
      }

      for (const doc of snapshot.docs) {
        resumen.usuariosRevisados += 1;

        try {
          const resultado = await this.procesarExpiracionUsuario(
            doc.id,
            diasExpiracion,
          );

          if (resultado.procesado) {
            resumen.usuariosProcesados += 1;
            resumen.ciclosProcesados += resultado.ciclosProcesados;
            resumen.puntosExpirados += resultado.puntosExpirados;
          }
        } catch (error) {
          console.error(
            `Error procesando expiración de puntos para ${doc.id}:`,
            error,
          );
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < pageSize) {
        break;
      }
    }

    return resumen;
  }

  async registrarMovimiento(
    uid: string,
    points: number,
    options: RegistrarMovimientoOptions,
  ): Promise<UsuarioApp> {
    if (!Number.isFinite(points) || points === 0) {
      throw new Error("La cantidad de puntos debe ser distinta de cero");
    }

    const diasExpiracion = await this.obtenerDiasExpiracionPuntos();
    await this.procesarExpiracionUsuario(uid, diasExpiracion);

    const userRef = firestoreApp.collection(USUARIOS_COLLECTION).doc(uid);

    return firestoreApp.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error("Usuario no encontrado");
      }

      const userData = userSnap.data() as UsuarioApp;
      if (!userData.createdAt) {
        throw new Error("El usuario no tiene fecha de registro");
      }

      const now = admin.firestore.Timestamp.now();
      const saldoAnterior = Number(userData.puntosActuales ?? 0);
      const saldoNuevo = saldoAnterior + points;

      if (saldoNuevo < 0) {
        throw new Error("El usuario no tiene puntos suficientes");
      }

      const cicloActual = obtenerCicloActual(
        userData.createdAt.toDate(),
        now.toDate(),
        diasExpiracion,
      );
      const historialActual = this.normalizarHistorialUsuario(
        userData.historialPuntos,
        cicloActual.numero,
        cicloActual.fechaFinProgramada,
      );
      const resumenRef = userRef
        .collection(HISTORIAL_PUNTOS_SUBCOLECCION)
        .doc(cicloActual.etiqueta);
      const resumenSnap = await tx.get(resumenRef);
      const resumenActual = resumenSnap.exists
        ? (resumenSnap.data() as ResumenPuntosAnual)
        : construirResumenPuntosAnual(cicloActual, saldoAnterior);

      const resumenActualizado = aplicarMovimientoAResumen(resumenActual, {
        tipo: options.tipo,
        puntos: points,
        saldoAnterior,
        saldoNuevo,
        fechaMovimiento: now,
      });

      const movimientoRef = userRef.collection(MOVIMIENTOS_PUNTOS_SUBCOLECCION).doc();
      const movimiento: MovimientoPuntos = {
        id: movimientoRef.id,
        usuarioId: uid,
        tipo: options.tipo,
        puntos: points,
        saldoAnterior,
        saldoNuevo,
        origen: options.origen,
        origenId: options.origenId,
        referencia: options.referencia,
        descripcion: options.descripcion,
        cicloAnual: cicloActual.numero,
        etiquetaCiclo: cicloActual.etiqueta,
        createdAt: now,
      };

      const historialActualizado = this.actualizarHistorialUsuario(
        historialActual,
        resumenActualizado,
        cicloActual.numero,
        cicloActual.fechaFinProgramada,
      );

      tx.set(movimientoRef, movimiento);
      tx.set(resumenRef, resumenActualizado, { merge: true });
      tx.set(
        userRef,
        {
          puntosActuales: saldoNuevo,
          updatedAt: now,
          historialPuntos: historialActualizado,
        },
        { merge: true },
      );

      return {
        ...userData,
        id: userSnap.id,
        puntosActuales: saldoNuevo,
        updatedAt: now,
        historialPuntos: historialActualizado,
      } as UsuarioApp;
    });
  }

  async procesarExpiracionUsuario(
    uid: string,
    diasExpiracion: number,
  ): Promise<ResultadoExpiracionUsuario> {
    const userRef = firestoreApp.collection(USUARIOS_COLLECTION).doc(uid);

    return firestoreApp.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        return {
          procesado: false,
          usuarioId: uid,
          ciclosProcesados: 0,
          puntosExpirados: 0,
        };
      }

      const userData = userSnap.data() as UsuarioApp;

      if (!userData.createdAt) {
        return {
          procesado: false,
          usuarioId: uid,
          ciclosProcesados: 0,
          puntosExpirados: 0,
        };
      }

      const now = admin.firestore.Timestamp.now();
      const fechaRegistro = userData.createdAt.toDate();
      const ciclosCompletados = calcularCiclosCompletados(
        fechaRegistro,
        now.toDate(),
        diasExpiracion,
      );
      const cicloActual = obtenerCicloActual(
        fechaRegistro,
        now.toDate(),
        diasExpiracion,
      );
      const historialActual = this.normalizarHistorialUsuario(
        userData.historialPuntos,
        cicloActual.numero,
        cicloActual.fechaFinProgramada,
      );
      const ultimoCicloProcesado = Number(historialActual.ultimoCicloProcesado ?? 0);

      if (ciclosCompletados <= ultimoCicloProcesado) {
        if (
          historialActual.cicloActual !== cicloActual.numero ||
          historialActual.proximaExpiracionProgramada.toMillis() !==
            cicloActual.fechaFinProgramada.toMillis()
        ) {
          tx.set(
            userRef,
            {
              historialPuntos: {
                ...historialActual,
                cicloActual: cicloActual.numero,
                proximaExpiracionProgramada: cicloActual.fechaFinProgramada,
              },
            },
            { merge: true },
          );
        }

        return {
          procesado: false,
          usuarioId: uid,
          ciclosProcesados: 0,
          puntosExpirados: 0,
        };
      }

      let saldoVigente = Number(userData.puntosActuales ?? 0);
      let puntosExpirados = 0;
      let seRegistroExpiracion = false;
      const resumenesActualizados: Record<string, ResumenPuntosAnual> = {
        ...historialActual.resumenes,
      };

      for (
        let cicloNumero = ultimoCicloProcesado + 1;
        cicloNumero <= ciclosCompletados;
        cicloNumero += 1
      ) {
        const ciclo = obtenerCicloPorNumero(fechaRegistro, cicloNumero, diasExpiracion);
        const resumenRef = userRef
          .collection(HISTORIAL_PUNTOS_SUBCOLECCION)
          .doc(ciclo.etiqueta);
        const resumenSnap = await tx.get(resumenRef);

        let resumen = resumenSnap.exists
          ? (resumenSnap.data() as ResumenPuntosAnual)
          : construirResumenPuntosAnual(ciclo, saldoVigente);

        if (!seRegistroExpiracion && saldoVigente > 0) {
          const saldoAnterior = saldoVigente;
          saldoVigente = 0;
          puntosExpirados = saldoAnterior;
          resumen = aplicarMovimientoAResumen(resumen, {
            tipo: TipoMovimientoPuntos.EXPIRACION,
            puntos: -saldoAnterior,
            saldoAnterior,
            saldoNuevo: 0,
            fechaMovimiento: now,
          });

          const movimientoRef = userRef.collection(MOVIMIENTOS_PUNTOS_SUBCOLECCION).doc();
          const movimiento: MovimientoPuntos = {
            id: movimientoRef.id,
            usuarioId: uid,
            tipo: TipoMovimientoPuntos.EXPIRACION,
            puntos: -saldoAnterior,
            saldoAnterior,
            saldoNuevo: 0,
            origen: "sistema",
            descripcion: `Expiración automática del ciclo ${ciclo.etiqueta}`,
            cicloAnual: ciclo.numero,
            etiquetaCiclo: ciclo.etiqueta,
            createdAt: now,
          };

          tx.set(movimientoRef, movimiento);
          seRegistroExpiracion = true;
        } else {
          resumen = {
            ...resumen,
            fechaExpiracionAplicada: now,
            saldoAntesDeExpirar: resumen.saldoFinal,
            saldoFinal: 0,
          };
        }

        tx.set(resumenRef, resumen, { merge: true });
        resumenesActualizados[ciclo.etiqueta] = resumen;
      }

      const historialActualizado: HistorialPuntosUsuario = {
        ultimoCicloProcesado: ciclosCompletados,
        cicloActual: cicloActual.numero,
        proximaExpiracionProgramada: cicloActual.fechaFinProgramada,
        resumenes: resumenesActualizados,
      };

      tx.set(
        userRef,
        {
          puntosActuales: saldoVigente,
          updatedAt: now,
          historialPuntos: historialActualizado,
        },
        { merge: true },
      );

      return {
        procesado: true,
        usuarioId: uid,
        ciclosProcesados: ciclosCompletados - ultimoCicloProcesado,
        puntosExpirados,
      };
    });
  }

  private normalizarHistorialUsuario(
    historial: HistorialPuntosUsuario | undefined,
    cicloActual: number,
    proximaExpiracionProgramada: Timestamp,
  ): HistorialPuntosUsuario {
    return {
      ultimoCicloProcesado: Number(historial?.ultimoCicloProcesado ?? 0),
      cicloActual: Number(historial?.cicloActual ?? cicloActual),
      proximaExpiracionProgramada:
        historial?.proximaExpiracionProgramada ?? proximaExpiracionProgramada,
      resumenes: historial?.resumenes ?? {},
    };
  }

  private actualizarHistorialUsuario(
    historial: HistorialPuntosUsuario,
    resumen: ResumenPuntosAnual,
    cicloActual: number,
    proximaExpiracionProgramada: Timestamp,
  ): HistorialPuntosUsuario {
    return {
      ultimoCicloProcesado: historial.ultimoCicloProcesado,
      cicloActual,
      proximaExpiracionProgramada,
      resumenes: {
        ...historial.resumenes,
        [resumen.etiqueta]: resumen,
      },
    };
  }

  private async obtenerDiasExpiracionPuntos(): Promise<number> {
    const configSnap = await firestoreApp
      .collection(CONFIGURACION_COLLECTION)
      .doc(CONFIGURACION_PUNTOS_DOC)
      .get();

    const diasConfigurados = Number(configSnap.data()?.diasExpiracionPuntos);

    if (Number.isFinite(diasConfigurados) && diasConfigurados > 0) {
      return diasConfigurados;
    }

    return configuracionExpiracionPuntos.diasExpiracionPorDefecto;
  }
}

export default new PointsService();