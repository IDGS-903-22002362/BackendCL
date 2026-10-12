import { randomInt } from "crypto";
import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import type { Beneficio } from "../models/beneficios.model";
import {
  GuardarMinijuegoInput,
  MINIJUEGO_TIPOS,
  Minijuego,
  MinijuegoEstado,
  MinijuegoPlay,
  MinijuegoPremio,
  PrizeType,
} from "../models/minijuego.model";
import loyaltyEngineService from "../modules/loyalty/services/loyalty-engine.service";
import {
  BeneficioViewer,
  MinijuegoError,
  PreparedPremio,
  assertPlayable,
  assertIdempotencyKey,
  decidePlay,
  isVisibleInCatalog,
  normalizeEmail,
  buildSpecialWinner,
  resolveSpecialStock,
  rouletteSegmentLabel,
  rouletteSegments,
  toSpecialWinnersView,
  prepareMinijuegoWrite,
} from "./minijuego.logic";

const MINIJUEGOS_COLLECTION = "minijuegos";
const PREMIOS_SUBCOLLECTION = "premios";
const USUARIOS_COLLECTION = "usuariosApp";
const JUGADAS_SUBCOLLECTION = "minijuego_jugadas";
const ESTADO_SUBCOLLECTION = "minijuego_estado";
const BENEFICIOS_COLLECTION = "beneficios";
const GANADORES_ESPECIAL_COLLECTION = "ganadoresPremioEspecial";

export type MinijuegoActor = {
  uid: string;
  email?: string;
};

type PlayOutcome = {
  play: MinijuegoPlay;
  intentosRestantes: number;
};

export class MinijuegoService {
  private collection = firestoreApp.collection(MINIJUEGOS_COLLECTION);

  private premios(minijuegoId: string) {
    return this.collection.doc(minijuegoId).collection(PREMIOS_SUBCOLLECTION);
  }

  private plays(uid: string) {
    return firestoreApp
      .collection(USUARIOS_COLLECTION)
      .doc(uid)
      .collection(JUGADAS_SUBCOLLECTION);
  }

  private estadoRef(uid: string, minijuegoId: string) {
    return firestoreApp
      .collection(USUARIOS_COLLECTION)
      .doc(uid)
      .collection(ESTADO_SUBCOLLECTION)
      .doc(minijuegoId);
  }

  async setEstatus(minijuegoId: string, estatus: boolean): Promise<void> {
    const ref = this.collection.doc(minijuegoId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return;

    await ref.update({
      estatus,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  async deleteLinked(minijuegoId: string): Promise<void> {
    const premios = await this.premios(minijuegoId).get();
    const batch = firestoreApp.batch();
    premios.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(this.collection.doc(minijuegoId));
    await batch.commit();
  }

  async presentCatalog(
    beneficios: Beneficio[],
    viewer: BeneficioViewer,
    serialize: (beneficio: Beneficio) => Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const ids = this.linkedIds(beneficios);
    const minijuegos = await this.loadMany(ids);
    const estados =
      viewer.uid && !viewer.adminView
        ? await this.loadEstados(viewer.uid, ids)
        : new Map<string, MinijuegoEstado>();
    const result: Record<string, unknown>[] = [];

    for (const beneficio of beneficios) {
      const minijuego = this.linkedMinijuego(beneficio, minijuegos);
      const allowed = isVisibleInCatalog({
        tipo: beneficio.tipo,
        beneficioActivo: beneficio.estatus,
        minijuego,
        uid: viewer.uid,
        now,
        adminView: viewer.adminView,
      });
      if (
        process.env.NODE_ENV !== "production" &&
        beneficio.tipo === "minijuego"
      ) {
        console.info(
          "[LOCAL GET /beneficios]\n" +
            "uid=" + (viewer.uid ?? "") + "\n" +
            "authPresent=" + Boolean(viewer.uid) + "\n" +
            "minigameId=" + (minijuego?.id ?? "") + "\n" +
            "visibility=" + (minijuego?.audiencia.visibilidad ?? "") + "\n" +
            "allowed=" + allowed,
        );
      }
      if (!allowed) {
        continue;
      }

      const json = serialize(beneficio);
      if (viewer.adminView && beneficio.tipo === "minijuego") {
        json.minijuegoVisibilidad = minijuego?.audiencia.visibilidad ?? null;
        json.usuariosPermitidosCount =
          minijuego?.audiencia.usuariosPermitidos.length ?? 0;
      } else if (viewer.uid && minijuego) {
        const usados = estados.get(minijuego.id)?.intentosUsados ?? 0;
        json.intentosRestantes = Math.max(
          0,
          minijuego.intentosPorUsuario - usados,
        );
      }
      result.push(json);
    }

    if (process.env.NODE_ENV !== "production") {
      console.info("beneficios_catalog", {
        authPresent: Boolean(viewer.uid),
        authenticatedUid: viewer.uid ?? null,
        adminView: viewer.adminView,
        returned: result.length,
      });
    }

    return result;
  }

  async presentOne(
    beneficio: Beneficio,
    viewer: BeneficioViewer,
    serialize: (beneficio: Beneficio) => Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const minijuego = beneficio.minijuegoId
      ? await this.loadOne(beneficio.minijuegoId)
      : null;
    const visible = isVisibleInCatalog({
      tipo: beneficio.tipo,
      beneficioActivo: beneficio.estatus,
      minijuego,
      uid: viewer.uid,
      now: new Date(),
      adminView: viewer.adminView,
    });

    if (!visible) return null;

    const json = serialize(beneficio);
    if (viewer.adminView && beneficio.tipo === "minijuego" && minijuego) {
      const premios = await this.loadPremios(minijuego.id);
      json.minijuego = this.toAdminMinijuego(minijuego, premios);
      json.minijuegoVisibilidad = minijuego.audiencia.visibilidad;
      json.usuariosPermitidosCount = minijuego.audiencia.usuariosPermitidos.length;
    } else if (viewer.uid && minijuego) {
      const estado = await this.loadEstado(viewer.uid, minijuego.id);
      const usados = estado?.intentosUsados ?? 0;
      json.intentosRestantes = Math.max(0, minijuego.intentosPorUsuario - usados);
    }

    return json;
  }

  async createMinijuegoBeneficio(
    input: GuardarMinijuegoInput,
  ): Promise<Record<string, unknown>> {
    if (process.env.NODE_ENV !== "production") {
      console.info("[LOCAL SAVE minijuego]", {
        visibilidad: input.minijuego?.audiencia?.visibilidad ?? null,
        usuariosPermitidos: input.minijuego?.audiencia?.usuariosPermitidos ?? [],
      });
    }
    const prepared = prepareMinijuegoWrite(input);
    await this.assertUsuariosExisten(prepared.minijuego.audiencia.usuariosPermitidos);
    const beneficioRef = firestoreApp.collection(BENEFICIOS_COLLECTION).doc();
    const minijuegoRef = this.collection.doc(beneficioRef.id);
    const now = new Date();
    const nowTs = admin.firestore.Timestamp.fromDate(now);
    const premioWrites = prepared.premios.map((premio) => ({
      ref: this.premios(minijuegoRef.id).doc(),
      premio,
    }));

    await firestoreApp.runTransaction(async (tx) => {
      tx.set(beneficioRef, {
        id: beneficioRef.id,
        titulo: prepared.beneficio.titulo,
        descripcion: prepared.beneficio.descripcion,
        estatus: prepared.beneficio.estatus,
        puntosRecompensa: 0,
        redireccion: { modulo: "none" },
        tipo: "minijuego",
        minijuegoId: minijuegoRef.id,
        minijuegoTipo: prepared.minijuego.tipo,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      tx.set(
        minijuegoRef,
        this.minijuegoDocument({
          id: minijuegoRef.id,
          beneficioId: beneficioRef.id,
          prepared,
          now: nowTs,
          createdAt: nowTs,
        }),
      );
      for (const item of premioWrites) {
        tx.set(
          item.ref,
          this.premioDocument(item.ref.id, minijuegoRef.id, item.premio, nowTs),
        );
      }
    });

    const beneficio = await this.readBeneficio(beneficioRef.id);
    return this.adminResponse(beneficio);
  }

  async updateMinijuegoBeneficio(
    beneficioId: string,
    input: GuardarMinijuegoInput,
  ): Promise<Record<string, unknown>> {
    if (process.env.NODE_ENV !== "production") {
      console.info("[LOCAL SAVE minijuego]", {
        visibilidad: input.minijuego?.audiencia?.visibilidad ?? null,
        usuariosPermitidos: input.minijuego?.audiencia?.usuariosPermitidos ?? [],
      });
    }
    const prepared = prepareMinijuegoWrite(input);
    await this.assertUsuariosExisten(prepared.minijuego.audiencia.usuariosPermitidos);
    const beneficioRef = firestoreApp
      .collection(BENEFICIOS_COLLECTION)
      .doc(beneficioId);

    await firestoreApp.runTransaction(async (tx) => {
      const beneficioSnap = await tx.get(beneficioRef);
      if (!beneficioSnap.exists) {
        throw new MinijuegoError(
          "BENEFICIO_NOT_FOUND",
          404,
          `Beneficio con ID ${beneficioId} no encontrado`,
        );
      }

      const current = beneficioSnap.data() ?? {};
      const minijuegoId =
        typeof current.minijuegoId === "string" && current.minijuegoId.trim()
          ? current.minijuegoId.trim()
          : beneficioId;
      const minijuegoRef = this.collection.doc(minijuegoId);
      const minijuegoSnap = await tx.get(minijuegoRef);
      const premiosSnap = await tx.get(this.premios(minijuegoId));
      const ganadoresSnap = await tx.get(
        firestoreApp
          .collection(GANADORES_ESPECIAL_COLLECTION)
          .where("minijuegoId", "==", minijuegoId)
          .limit(200),
      );
      const nowTs = admin.firestore.Timestamp.now();
      const createdAt = minijuegoSnap.exists
        ? minijuegoSnap.data()?.createdAt ?? nowTs
        : nowTs;

      tx.set(
        beneficioRef,
        {
          titulo: prepared.beneficio.titulo,
          descripcion: prepared.beneficio.descripcion,
          estatus: prepared.beneficio.estatus,
          puntosRecompensa: 0,
          redireccion: { modulo: "none" },
          tipo: "minijuego",
          minijuegoId,
          minijuegoTipo: prepared.minijuego.tipo,
          updatedAt: nowTs,
        },
        { merge: true },
      );
      tx.set(
        minijuegoRef,
        this.minijuegoDocument({
          id: minijuegoId,
          beneficioId,
          prepared,
          now: nowTs,
          createdAt,
        }),
      );

      const keptIds = new Set(
        prepared.premios
          .map((premio) => premio.id)
          .filter((id): id is string => !!id),
      );
      const existingIds = new Set(premiosSnap.docs.map((doc) => doc.id));

      for (const doc of premiosSnap.docs) {
        if (!keptIds.has(doc.id)) {
          tx.delete(doc.ref);
        }
      }

      const existingById = new Map(
        premiosSnap.docs.map((doc) => [doc.id, doc.data()]),
      );
      for (const premio of prepared.premios) {
        const ref =
          premio.id && existingIds.has(premio.id)
            ? this.premios(minijuegoId).doc(premio.id)
            : this.premios(minijuegoId).doc();
        const previous = premio.id ? existingById.get(premio.id) : undefined;
        const resolved =
          premio.especial &&
          premio.stock != null
            ? resolveSpecialStock({
                requestedMax: premio.maxGanadores ?? premio.stock,
                previousMax:
                  typeof previous?.maxGanadores === "number"
                    ? previous.maxGanadores
                    : null,
                previousStock:
                  typeof previous?.stock === "number" ? previous.stock : null,
                awarded: ganadoresSnap.size,
              })
            : null;
        const stored = resolved
          ? { ...premio, stock: resolved.stock, maxGanadores: resolved.maxGanadores }
          : premio;
        tx.set(ref, this.premioDocument(ref.id, minijuegoId, stored, nowTs));
      }
    });

    const beneficio = await this.readBeneficio(beneficioId);
    return this.adminResponse(beneficio);
  }

  async getDetails(minijuegoId: string, actor: MinijuegoActor) {
    const loaded = await this.loadPlayContext(minijuegoId, actor);
    if ((loaded.estado?.intentosUsados ?? 0) <= 0) {
      assertPlayable({
        uid: actor.uid,
        beneficioActivo: loaded.beneficioActivo,
        minijuego: loaded.minijuego,
        now: new Date(),
      });
    }

    const premios = await this.loadPremios(minijuegoId);
    const pending = await this.readPendingPlay(
      actor.uid,
      minijuegoId,
      loaded.estado,
    );
    const settled = pending ? await this.settlePoints(pending) : null;
    const usados = loaded.estado?.intentosUsados ?? 0;

    return {
      id: loaded.minijuego.id,
      beneficioId: loaded.minijuego.beneficioId,
      tipo: loaded.minijuego.tipo,
      titulo: loaded.titulo,
      descripcion: loaded.descripcion,
      intentosPorUsuario: loaded.minijuego.intentosPorUsuario,
      intentosUsados: usados,
      intentosRestantes: Math.max(
        0,
        loaded.minijuego.intentosPorUsuario - usados,
      ),
      segments: rouletteSegments(premios, pending?.prizeId).map((premio) =>
        this.toSegment(premio),
      ),
      pendingPlay: settled
        ? this.toPlayResponse(
            settled,
            Math.max(0, loaded.minijuego.intentosPorUsuario - usados),
          )
        : null,
    };
  }

  async getPendingPlay(minijuegoId: string, actor: MinijuegoActor) {
    const loaded = await this.loadPlayContext(minijuegoId, actor);
    const pending = await this.readPendingPlay(
      actor.uid,
      minijuegoId,
      loaded.estado,
    );
    const usados = loaded.estado?.intentosUsados ?? 0;
    const restantes = Math.max(0, loaded.minijuego.intentosPorUsuario - usados);

    if (!pending) {
      assertPlayable({
        uid: actor.uid,
        beneficioActivo: loaded.beneficioActivo,
        minijuego: loaded.minijuego,
        now: new Date(),
      });
      return null;
    }

    const settled = await this.settlePoints(pending);
    return this.toPlayResponse(settled, restantes);
  }

  async play(
    minijuegoId: string,
    actor: MinijuegoActor,
    idempotencyKeyRaw: unknown,
  ) {
    const idempotencyKey = assertIdempotencyKey(idempotencyKeyRaw);
    const outcome = await firestoreApp.runTransaction(async (tx) => {
      const minijuegoRef = this.collection.doc(minijuegoId);
      const minijuegoSnap = await tx.get(minijuegoRef);
      if (!minijuegoSnap.exists) {
        throw new MinijuegoError(
          "MINIGAME_NOT_FOUND",
          404,
          "Minijuego no encontrado.",
        );
      }

      const minijuego = this.mapMinijuego(minijuegoSnap);
      if (!minijuego) {
        throw new MinijuegoError(
          "MINIGAME_NOT_FOUND",
          404,
          "Minijuego no encontrado.",
        );
      }

      const beneficioSnap = await tx.get(
        firestoreApp.collection(BENEFICIOS_COLLECTION).doc(minijuego.beneficioId),
      );
      const estadoRef = this.estadoRef(actor.uid, minijuegoId);
      const estadoSnap = await tx.get(estadoRef);
      const premiosSnap = await tx.get(this.premios(minijuegoId));
      const estado = estadoSnap.exists
        ? this.mapEstado(estadoSnap.data() ?? {})
        : null;
      const premios = premiosSnap.docs
        .map((doc) => this.mapPremio(doc))
        .sort((left, right) => left.orden - right.orden);
      const beneficioActivo =
        beneficioSnap.exists && beneficioSnap.data()?.estatus === true;
      const decision = decidePlay({
        uid: actor.uid,
        beneficioActivo,
        minijuego,
        premios,
        estado,
        idempotencyKey,
        now: new Date(),
        randomInt: (max) => randomInt(0, max),
      });

      if (decision.type === "replay") {
        const playSnap = await tx.get(this.plays(actor.uid).doc(decision.playId));
        if (!playSnap.exists) {
          throw new MinijuegoError(
            "MINIGAME_PLAY_NOT_FOUND",
            500,
            "No pudimos recuperar la participación.",
          );
        }

        const usados = estado?.intentosUsados ?? 0;
        return {
          play: this.mapPlay(playSnap, true),
          intentosRestantes: Math.max(0, minijuego.intentosPorUsuario - usados),
        } satisfies PlayOutcome;
      }

      const prize = decision.prize;
      const winnerProfile =
        prize.especial === true
          ? buildSpecialWinner({
              tipo: minijuego.tipo,
              especial: true,
              uid: actor.uid,
              profile: (
                await tx.get(
                  firestoreApp.collection(USUARIOS_COLLECTION).doc(actor.uid),
                )
              ).data(),
            })
          : null;
      const playRef = this.plays(actor.uid).doc();
      const now = admin.firestore.Timestamp.now();
      const status =
        prize.tipo === "points" && (prize.valor ?? 0) > 0
          ? "pending_reward"
          : "completed";
      const playData: FirebaseFirestore.DocumentData = {
        id: playRef.id,
        minijuegoId,
        userId: actor.uid,
        prizeId: prize.id,
        prizeType: prize.tipo,
        prizeName: prize.nombre,
        status,
        idempotencyKey,
        revelado: false,
        createdAt: now,
      };
      if (prize.descripcion) playData.prizeDescription = prize.descripcion;
      if (prize.valor != null) playData.prizeValue = prize.valor;
      if (prize.imagenUrl) playData.prizeImageUrl = prize.imagenUrl;

      tx.set(playRef, playData);
      if (typeof prize.stock === "number") {
        if (prize.stock <= 0) {
          throw new MinijuegoError(
            "MINIGAME_NO_PRIZES",
            409,
            "Este minijuego no tiene premios disponibles.",
          );
        }
        tx.update(this.premios(minijuegoId).doc(prize.id), {
          stock: prize.stock - 1,
          updatedAt: now,
        });
      }

      if (winnerProfile) {
        const beneficioData = beneficioSnap.data() ?? {};
        tx.set(
          firestoreApp.collection(GANADORES_ESPECIAL_COLLECTION).doc(playRef.id),
          {
            id: playRef.id,
            playId: playRef.id,
            minijuegoId,
            beneficioId: minijuego.beneficioId,
            beneficioTitulo:
              typeof beneficioData.titulo === "string" ? beneficioData.titulo : "",
            uid: winnerProfile.uid,
            email: winnerProfile.email,
            telefono: winnerProfile.telefono,
            premioId: prize.id,
            premioNombre: prize.nombre,
            createdAt: now,
          },
        );
      }

      const usados = (estado?.intentosUsados ?? 0) + 1;
      tx.set(estadoRef, {
        intentosUsados: usados,
        ultimaPlayId: playRef.id,
        claves: {
          ...(estado?.claves ?? {}),
          [idempotencyKey]: playRef.id,
        },
        updatedAt: now,
      });

      return {
        play: {
          id: playRef.id,
          minijuegoId,
          userId: actor.uid,
          prizeId: prize.id,
          prizeType: prize.tipo,
          prizeName: prize.nombre,
          prizeDescription: prize.descripcion,
          prizeValue: prize.valor,
          prizeImageUrl: prize.imagenUrl,
          status,
          idempotencyKey,
          revelado: false,
          createdAt: new Date(),
          alreadyPlayed: false,
        },
        intentosRestantes: Math.max(0, minijuego.intentosPorUsuario - usados),
      } satisfies PlayOutcome;
    });

    const play = await this.settlePoints(outcome.play);
    return this.toPlayResponse(play, outcome.intentosRestantes);
  }

  async acknowledge(minijuegoId: string, playId: string, actor: MinijuegoActor) {
    const ref = this.plays(actor.uid).doc(playId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new MinijuegoError(
        "MINIGAME_PLAY_NOT_FOUND",
        404,
        "Participación no encontrada.",
      );
    }

    let play = this.mapPlay(snapshot, true);
    if (play.userId !== actor.uid || play.minijuegoId !== minijuegoId) {
      throw new MinijuegoError(
        "MINIGAME_ACCESS_DENIED",
        403,
        "Este minijuego ya no está disponible para tu cuenta.",
      );
    }

    play = await this.settlePoints(play);
    if (!play.revelado) {
      await ref.set({ revelado: true }, { merge: true });
      play = { ...play, revelado: true };
    }

    const estado = await this.loadEstado(actor.uid, minijuegoId);
    const minijuego = await this.loadOne(minijuegoId);
    const usados = estado?.intentosUsados ?? 0;
    const restantes = minijuego
      ? Math.max(0, minijuego.intentosPorUsuario - usados)
      : 0;
    return this.toPlayResponse(play, restantes);
  }

  private async readBeneficio(id: string): Promise<Beneficio> {
    const { default: beneficioService } = await import("./beneficio.service");
    const beneficio = await beneficioService.getBeneficioById(id);
    if (!beneficio) {
      throw new MinijuegoError(
        "BENEFICIO_NOT_FOUND",
        404,
        `Beneficio con ID ${id} no encontrado`,
      );
    }
    return beneficio;
  }

  private async adminResponse(beneficio: Beneficio) {
    const { default: beneficioService } = await import("./beneficio.service");
    const json = beneficioService.serializeBeneficioForApi(
      beneficio,
    ) as Record<string, unknown>;
    if (!beneficio.minijuegoId) return json;

    const minijuego = await this.loadOne(beneficio.minijuegoId);
    if (!minijuego) return json;
    const premios = await this.loadPremios(minijuego.id);
    json.minijuego = this.toAdminMinijuego(minijuego, premios);
    json.minijuegoVisibilidad = minijuego.audiencia.visibilidad;
    json.usuariosPermitidosCount = minijuego.audiencia.usuariosPermitidos.length;
    return json;
  }

  private async loadPlayContext(minijuegoId: string, actor: MinijuegoActor) {
    const minijuego = await this.loadOne(minijuegoId);
    if (!minijuego) {
      throw new MinijuegoError(
        "MINIGAME_NOT_FOUND",
        404,
        "Minijuego no encontrado.",
      );
    }

    const beneficioSnap = await firestoreApp
      .collection(BENEFICIOS_COLLECTION)
      .doc(minijuego.beneficioId)
      .get();
    const beneficioData = beneficioSnap.data() ?? {};
    const estado = await this.loadEstado(actor.uid, minijuegoId);

    return {
      minijuego,
      beneficioActivo: beneficioSnap.exists && beneficioData.estatus === true,
      titulo: typeof beneficioData.titulo === "string" ? beneficioData.titulo : "",
      descripcion:
        typeof beneficioData.descripcion === "string"
          ? beneficioData.descripcion
          : "",
      estado,
    };
  }

  private async readPendingPlay(
    uid: string,
    minijuegoId: string,
    estado: MinijuegoEstado | null,
  ): Promise<MinijuegoPlay | null> {
    if (!estado?.ultimaPlayId) return null;
    const snapshot = await this.plays(uid).doc(estado.ultimaPlayId).get();
    if (!snapshot.exists) return null;
    const play = this.mapPlay(snapshot, true);
    if (play.minijuegoId !== minijuegoId || play.revelado) return null;
    return play;
  }

  private async settlePoints(play: MinijuegoPlay): Promise<MinijuegoPlay> {
    if (play.status !== "pending_reward") return play;

    if (play.prizeType !== "points" || !play.prizeValue || play.prizeValue <= 0) {
      await this.plays(play.userId).doc(play.id).set(
        { status: "completed" },
        { merge: true },
      );
      return { ...play, status: "completed" };
    }

    try {
      const txn = await loyaltyEngineService.applyMinijuegoPrizeBonus(
        play.userId,
        play.id,
        play.prizeValue,
        play.prizeName,
        play.userId,
      );
      await this.plays(play.userId).doc(play.id).set(
        {
          status: "completed",
          loyaltySynced: true,
          ...(txn?.transactionId ? { transactionId: txn.transactionId } : {}),
        },
        { merge: true },
      );
      return {
        ...play,
        status: "completed",
        transactionId: txn?.transactionId ?? play.transactionId,
      };
    } catch (error) {
      console.error("minijuego_reward_pending", {
        playId: play.id,
        minijuegoId: play.minijuegoId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new MinijuegoError(
        "MINIGAME_REWARD_PENDING",
        503,
        "No pudimos completar la participación. Intenta de nuevo.",
      );
    }
  }

  private toPlayResponse(play: MinijuegoPlay, intentosRestantes: number) {
    return {
      id: play.id,
      minijuegoId: play.minijuegoId,
      prizeId: play.prizeId,
      prizeType: play.prizeType,
      prizeName: play.prizeName,
      ...(play.prizeDescription
        ? { prizeDescription: play.prizeDescription }
        : {}),
      ...(play.prizeValue != null ? { prizeValue: play.prizeValue } : {}),
      ...(play.prizeImageUrl ? { prizeImageUrl: play.prizeImageUrl } : {}),
      resultPresentationKey: play.prizeId,
      alreadyPlayed: play.alreadyPlayed,
      createdAt: play.createdAt,
      status: play.status,
      intentosRestantes,
    };
  }

  private toSegment(premio: MinijuegoPremio) {
    return {
      id: premio.id,
      label: rouletteSegmentLabel(premio),
      ...(premio.imagenUrl ? { imageUrl: premio.imagenUrl } : {}),
      ...(premio.color ? { color: premio.color } : {}),
    };
  }

  private toAdminMinijuego(minijuego: Minijuego, premios: MinijuegoPremio[]) {
    return {
      id: minijuego.id,
      tipo: minijuego.tipo,
      estatus: minijuego.estatus,
      ...(minijuego.fechaInicio
        ? { fechaInicio: minijuego.fechaInicio.toISOString() }
        : {}),
      ...(minijuego.fechaFin
        ? { fechaFin: minijuego.fechaFin.toISOString() }
        : {}),
      intentosPorUsuario: minijuego.intentosPorUsuario,
      audiencia: {
        visibilidad: minijuego.audiencia.visibilidad,
        usuariosPermitidos: [...minijuego.audiencia.usuariosPermitidos],
      },
      premios: premios.map((premio) => ({
        id: premio.id,
        nombre: premio.nombre,
        tipo: premio.tipo,
        ...(premio.valor != null ? { valor: premio.valor } : {}),
        stock: premio.stock,
        weight: premio.weight,
        ...(premio.especial ? { especial: true } : {}),
        ...(premio.maxGanadores != null
          ? { maxGanadores: premio.maxGanadores }
          : {}),
        ...(premio.descripcion ? { descripcion: premio.descripcion } : {}),
        ...(premio.imagenUrl ? { imagenUrl: premio.imagenUrl } : {}),
        ...(premio.color ? { color: premio.color } : {}),
      })),
    };
  }

  private minijuegoDocument(input: {
    id: string;
    beneficioId: string;
    prepared: ReturnType<typeof prepareMinijuegoWrite>;
    now: FirebaseFirestore.Timestamp;
    createdAt: unknown;
  }) {
    const document: FirebaseFirestore.DocumentData = {
      id: input.id,
      beneficioId: input.beneficioId,
      tipo: input.prepared.minijuego.tipo,
      estatus: input.prepared.beneficio.estatus,
      intentosPorUsuario: input.prepared.minijuego.intentosPorUsuario,
      audiencia: input.prepared.minijuego.audiencia,
      createdAt: input.createdAt,
      updatedAt: input.now,
    };

    if (input.prepared.minijuego.fechaInicio) {
      document.fechaInicio = admin.firestore.Timestamp.fromDate(
        input.prepared.minijuego.fechaInicio,
      );
    }

    if (input.prepared.minijuego.fechaFin) {
      document.fechaFin = admin.firestore.Timestamp.fromDate(
        input.prepared.minijuego.fechaFin,
      );
    }

    return document;
  }

  private premioDocument(
    id: string,
    minijuegoId: string,
    premio: PreparedPremio,
    now: FirebaseFirestore.Timestamp,
  ) {
    const document: FirebaseFirestore.DocumentData = {
      id,
      minijuegoId,
      nombre: premio.nombre,
      tipo: premio.tipo,
      stock: premio.stock,
      weight: premio.weight,
      orden: premio.orden,
      color: premio.color,
      ...(premio.especial ? { especial: true } : {}),
      ...(premio.maxGanadores != null
        ? { maxGanadores: premio.maxGanadores }
        : {}),
      updatedAt: now,
    };
    if (premio.valor != null) document.valor = premio.valor;
    if (premio.imagenUrl) document.imagenUrl = premio.imagenUrl;
    if (premio.descripcion) document.descripcion = premio.descripcion;
    return document;
  }

  private linkedIds(beneficios: Beneficio[]): string[] {
    return beneficios
      .filter((item) => item.tipo === "minijuego" && item.minijuegoId)
      .map((item) => item.minijuegoId as string);
  }

  private linkedMinijuego(
    beneficio: Beneficio,
    minijuegos: Map<string, Minijuego>,
  ): Minijuego | null {
    if (beneficio.tipo !== "minijuego" || !beneficio.minijuegoId) return null;
    return minijuegos.get(beneficio.minijuegoId) ?? null;
  }

  private async loadMany(ids: string[]): Promise<Map<string, Minijuego>> {
    const unique = [...new Set(ids)];
    const map = new Map<string, Minijuego>();
    if (unique.length === 0) return map;

    const docs = await this.getAllDocs(
      unique.map((id) => this.collection.doc(id)),
    );
    for (const doc of docs) {
      if (!doc.exists) continue;
      const minijuego = this.mapMinijuego(doc);
      if (minijuego) map.set(doc.id, minijuego);
    }
    return map;
  }

  private async loadOne(id: string): Promise<Minijuego | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) return null;
    return this.mapMinijuego(snapshot);
  }

  private async loadPremios(minijuegoId: string): Promise<MinijuegoPremio[]> {
    const snapshot = await this.premios(minijuegoId).get();
    return snapshot.docs
      .map((doc) => this.mapPremio(doc))
      .sort((left, right) => left.orden - right.orden);
  }

  private async loadEstado(
    uid: string,
    minijuegoId: string,
  ): Promise<MinijuegoEstado | null> {
    const snapshot = await this.estadoRef(uid, minijuegoId).get();
    if (!snapshot.exists) return null;
    return this.mapEstado(snapshot.data() ?? {});
  }

  private async loadEstados(
    uid: string,
    ids: string[],
  ): Promise<Map<string, MinijuegoEstado>> {
    const unique = [...new Set(ids)];
    const map = new Map<string, MinijuegoEstado>();
    if (unique.length === 0) return map;

    const docs = await this.getAllDocs(
      unique.map((id) => this.estadoRef(uid, id)),
    );
    for (const doc of docs) {
      if (!doc.exists) continue;
      map.set(doc.id, this.mapEstado(doc.data() ?? {}));
    }
    return map;
  }

  private async getAllDocs(
    refs: FirebaseFirestore.DocumentReference[],
  ): Promise<FirebaseFirestore.DocumentSnapshot[]> {
    const docs: FirebaseFirestore.DocumentSnapshot[] = [];
    for (let index = 0; index < refs.length; index += 100) {
      const chunk = refs.slice(index, index + 100);
      const part = await firestoreApp.getAll(...chunk);
      docs.push(...part);
    }
    return docs;
  }

  private mapMinijuego(
    snapshot: FirebaseFirestore.DocumentSnapshot,
  ): Minijuego | null {
    const data = snapshot.data();
    if (!data) return null;
    if (
      typeof data.tipo !== "string" ||
      !(MINIJUEGO_TIPOS as readonly string[]).includes(data.tipo)
    ) {
      return null;
    }

    const audiencia = (data.audiencia ?? {}) as {
      visibilidad?: unknown;
      usuariosPermitidos?: unknown;
    };
    const usuariosRaw = audiencia.usuariosPermitidos;
    const usuarios = Array.isArray(usuariosRaw)
      ? usuariosRaw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
    const tipo = data.tipo as Minijuego["tipo"];

    return {
      id: snapshot.id,
      beneficioId:
        typeof data.beneficioId === "string" ? data.beneficioId : snapshot.id,
      tipo,
      estatus: data.estatus === true,
      ...(this.optionalDate(data.fechaInicio)
        ? { fechaInicio: this.optionalDate(data.fechaInicio) }
        : {}),
      ...(this.optionalDate(data.fechaFin)
        ? { fechaFin: this.optionalDate(data.fechaFin) }
        : {}),
      intentosPorUsuario:
        typeof data.intentosPorUsuario === "number" &&
        data.intentosPorUsuario >= 1
          ? Math.floor(data.intentosPorUsuario)
          : 1,
      audiencia: {
        visibilidad: (audiencia?.visibilidad === "publico" ||
          audiencia?.visibilidad === "restringido"
            ? audiencia.visibilidad
            : "oculto") as Minijuego["audiencia"]["visibilidad"],
        usuariosPermitidos: usuarios,
      },
      createdAt: this.normalizeDate(data.createdAt),
      updatedAt: this.normalizeDate(data.updatedAt),
    };
  }

  private mapPremio(
    snapshot: FirebaseFirestore.DocumentSnapshot,
  ): MinijuegoPremio {
    const data = snapshot.data() ?? {};
    const tipo = this.readPrizeType(data.tipo);
    return {
      id: snapshot.id,
      minijuegoId:
        typeof data.minijuegoId === "string" ? data.minijuegoId : "",
      nombre: typeof data.nombre === "string" ? data.nombre : "Premio",
      tipo,
      ...(typeof data.valor === "number" ? { valor: data.valor } : {}),
      stock: this.readStock(data.stock),
      weight:
        typeof data.weight === "number" && data.weight >= 1
          ? Math.floor(data.weight)
          : 1,
      orden: typeof data.orden === "number" ? data.orden : 0,
      ...(typeof data.color === "string" ? { color: data.color } : {}),
      ...(typeof data.imagenUrl === "string"
        ? { imagenUrl: data.imagenUrl }
        : {}),
      ...(typeof data.descripcion === "string"
        ? { descripcion: data.descripcion }
        : {}),
      ...(data.especial === true ? { especial: true } : {}),
      ...(typeof data.maxGanadores === "number"
        ? { maxGanadores: data.maxGanadores }
        : {}),
    };
  }

  private mapPlay(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    alreadyPlayed: boolean,
  ): MinijuegoPlay {
    const data = snapshot.data() ?? {};
    return {
      id: snapshot.id,
      minijuegoId:
        typeof data.minijuegoId === "string" ? data.minijuegoId : "",
      userId: typeof data.userId === "string" ? data.userId : "",
      prizeId: typeof data.prizeId === "string" ? data.prizeId : "",
      prizeType: this.readPrizeType(data.prizeType),
      prizeName: typeof data.prizeName === "string" ? data.prizeName : "",
      ...(typeof data.prizeDescription === "string"
        ? { prizeDescription: data.prizeDescription }
        : {}),
      ...(typeof data.prizeValue === "number"
        ? { prizeValue: data.prizeValue }
        : {}),
      ...(typeof data.prizeImageUrl === "string"
        ? { prizeImageUrl: data.prizeImageUrl }
        : {}),
      status: data.status === "pending_reward" ? "pending_reward" : "completed",
      idempotencyKey:
        typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
      revelado: data.revelado === true,
      createdAt: this.normalizeDate(data.createdAt),
      ...(typeof data.transactionId === "string"
        ? { transactionId: data.transactionId }
        : {}),
      alreadyPlayed,
    };
  }

  private mapEstado(data: FirebaseFirestore.DocumentData): MinijuegoEstado {
    const claves: Record<string, string> = {};
    if (data.claves && typeof data.claves === "object") {
      for (const [key, value] of Object.entries(
        data.claves as Record<string, unknown>,
      )) {
        if (typeof value === "string") claves[key] = value;
      }
    }

    return {
      intentosUsados:
        typeof data.intentosUsados === "number" && data.intentosUsados > 0
          ? Math.floor(data.intentosUsados)
          : 0,
      ...(typeof data.ultimaPlayId === "string"
        ? { ultimaPlayId: data.ultimaPlayId }
        : {}),
      claves,
    };
  }

  private readPrizeType(value: unknown): PrizeType {
    if (
      value === "points" ||
      value === "coupon" ||
      value === "physical" ||
      value === "digital" ||
      value === "none"
    ) {
      return value;
    }
    return "none";
  }

  private readStock(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return value;
    }
    return null;
  }

  private optionalDate(value: unknown): Date | undefined {
    if (value == null) return undefined;
    const date = this.normalizeDate(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date;
  }


  private async assertUsuariosExisten(uids: string[]): Promise<void> {
    for (const uid of uids) {
      const snapshot = await firestoreApp.collection("usuariosApp").doc(uid).get();
      if (!snapshot.exists) {
        throw new MinijuegoError(
          "MINIGAME_INVALID_USER",
          400,
          "Hay un usuario autorizado que no existe.",
        );
      }
    }
  }

  async migrateCorreosToUids(): Promise<{
    juegos: number;
    migrados: number;
    sinDocumento: string[];
  }> {
    const snapshot = await this.collection.get();
    const sinDocumento = new Set<string>();
    let migrados = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const audiencia = (data.audiencia ?? {}) as {
        visibilidad?: unknown;
        correosPermitidos?: unknown;
        usuariosPermitidos?: unknown;
      };
      const correos = Array.isArray(audiencia.correosPermitidos)
        ? audiencia.correosPermitidos.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      if (correos.length === 0) continue;

      const uids: string[] = [];
      for (const correo of correos) {
        const email = normalizeEmail(correo);
        if (!email) {
          sinDocumento.add(correo);
          continue;
        }
        const found = await firestoreApp
          .collection("usuariosApp")
          .where("email", "==", email)
          .limit(5)
          .get();
        const match = found.docs.find((item) => {
          const stored = item.data().uid;
          return (
            typeof stored !== "string" ||
            stored.trim() === "" ||
            stored === item.id
          );
        });
        if (!match) {
          sinDocumento.add(email);
          continue;
        }
        if (!uids.includes(match.id)) uids.push(match.id);
      }

      const existentes = Array.isArray(audiencia.usuariosPermitidos)
        ? audiencia.usuariosPermitidos.filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
        : [];
      const unidos = [
        ...new Set([...existentes.map((item) => item.trim()), ...uids]),
      ];
      await doc.ref.set(
        {
          audiencia: {
            visibilidad:
              audiencia.visibilidad === "publico" ? "publico" : "restringido",
            usuariosPermitidos: unidos,
          },
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      migrados += 1;
    }

    return {
      juegos: snapshot.size,
      migrados,
      sinDocumento: [...sinDocumento],
    };
  }

  async getGanadoresEspecial(minijuegoId: string) {
    const minijuegoSnap = await this.collection.doc(minijuegoId).get();
    if (!minijuegoSnap.exists) {
      throw new MinijuegoError(
        "MINIGAME_NOT_FOUND",
        404,
        "Minijuego no encontrado.",
      );
    }
    const premios = await this.loadPremios(minijuegoId);
    const especial = premios.find((premio) => premio.especial);
    const rows = await this.listGanadoresEspecial(minijuegoId);
    const maxGanadores =
      especial?.maxGanadores ??
      (especial?.stock != null ? especial.stock + rows.length : null);
    return toSpecialWinnersView({
      premio: especial?.nombre ?? "",
      maxGanadores,
      ganadores: rows.map((row) => ({
        uid: row.uid,
        email: row.email,
        telefono: row.telefono,
      })),
    });
  }

  async listGanadoresEspecial(minijuegoId?: string) {
    const collection = firestoreApp.collection(GANADORES_ESPECIAL_COLLECTION);
    const snapshot = minijuegoId
      ? await collection.where("minijuegoId", "==", minijuegoId).limit(200).get()
      : await collection.orderBy("createdAt", "desc").limit(200).get();

    return snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          playId: typeof data.playId === "string" ? data.playId : doc.id,
          minijuegoId:
            typeof data.minijuegoId === "string" ? data.minijuegoId : "",
          beneficioId:
            typeof data.beneficioId === "string" ? data.beneficioId : "",
          beneficioTitulo:
            typeof data.beneficioTitulo === "string" ? data.beneficioTitulo : "",
          uid: typeof data.uid === "string" ? data.uid : "",
          nombre: typeof data.nombre === "string" ? data.nombre : "",
          email: typeof data.email === "string" ? data.email : "",
          telefono: typeof data.telefono === "string" ? data.telefono : "",
          premioId: typeof data.premioId === "string" ? data.premioId : "",
          premioNombre:
            typeof data.premioNombre === "string" ? data.premioNombre : "",
          createdAt: this.normalizeDate(data.createdAt).toISOString(),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private normalizeDate(value: unknown): Date {
    if (
      value &&
      typeof value === "object" &&
      "toDate" in value &&
      typeof (value as { toDate: () => Date }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate();
    }

    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }

    return new Date();
  }

}

const minijuegoService = new MinijuegoService();

export default minijuegoService;
