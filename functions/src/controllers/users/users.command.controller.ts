import { Request, Response } from "express";
import { createHash } from "crypto";
import userAppService from "../../services/user.service";
import pointsService from "../../services/puntos.service";
import { admin } from "../../config/firebase.admin";
import { firestoreApp } from "../../config/app.firebase";
import { verifyClientAppCheckToken } from "../../utils/middlewares";
import seasonPassVerificationService, {
    SeasonPassVerificationError,
    SeasonPassPurchaseSummary,
    SeasonPassVerificationResult,
} from "../../services/season-pass-verification.service";
import loyaltyEngineService from "../../modules/loyalty/services/loyalty-engine.service";
import { LoyaltyActorType } from "../../modules/loyalty/models/loyalty.enums";

/**
 * Controller: Users Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
    try {
        const usuarioData = req.body;

        /**
        const camposRequeridos = [
            "clave",
            "descripcion",
            "lineaId",
            "categoriaId",
            "precioPublico",
            "precioCompra",
            "existencias",
            "proveedorId",
        ];

        const camposFaltantes = camposRequeridos.filter(
            (campo) => !usuarioData[campo] && usuarioData[campo] !== 0
        );

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Faltan campos requeridos",
                camposFaltantes,
            });
        }
             */

        usuarioData.activo =
            usuarioData.activo !== undefined ? usuarioData.activo : true;

        const nuevoUsuario = await userAppService.createUser(usuarioData);

        return res.status(201).json({
            success: true,
            message: "Usuario creado exitosamente",
            data: nuevoUsuario,
        });
    } catch (error) {
        console.error("Error en POST /api/usuarios:", error);
        return res.status(500).json({
            success: false,
            message: "Error al crear el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
export const checkEmail = async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const ensureMinDelay = async () => {
        const elapsed = Date.now() - startedAt;
        const minMs = 320;
        if (elapsed < minMs) {
            await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
        }
    };

    try {
        const rawEmail = req.query.email;
        const email =
            typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

        if (!email) {
            await ensureMinDelay();
            return res.status(400).json({
                success: false,
                message: "Email requerido",
            });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            await ensureMinDelay();
            return res.status(400).json({
                success: false,
                message: "Email invalido",
            });
        }

        const exists = await userAppService.existsByEmail(email);
        const appCheckToken = req.header("X-Firebase-AppCheck");
        let appCheckValid = false;

        if (appCheckToken) {
            try {
                await verifyClientAppCheckToken(appCheckToken);
                appCheckValid = true;
            } catch {
                appCheckValid = false;
            }
        }

        await ensureMinDelay();

        if (!appCheckValid) {
            return res.status(200).json({
                success: true,
                message:
                    "Verificacion completada. Continua con el registro si el correo es valido.",
            });
        }

        return res.status(200).json({
            success: true,
            exists,
        });
    } catch (error) {
        await ensureMinDelay();
        return res.status(500).json({
            success: false,
            message: "Error al verificar email",
        });
    }
};


export const update = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const usarioActualizado = await userAppService.updateUser(
            id,
            updateData
        );

        return res.status(200).json({
            success: true,
            message: "Usuario actualizado exitosamente",
            data: usarioActualizado,
        });
    } catch (error) {
        console.error("Error en PUT /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al actualizar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};


export const actualizarPerfil = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const { nombre, telefono } = req.body;

        const usuario = await userAppService.updateByUid(uid, {
            nombre,
            telefono
        });

        return res.status(200).json({
            success: true,
            data: usuario
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error actualizando perfil"
        });
    }
};



const calcularEdad = (fechaNacimiento?: string | Date): number | null => {
    if (!fechaNacimiento) return null;

    const nacimiento = new Date(fechaNacimiento);
    if (isNaN(nacimiento.getTime())) return null;

    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();

    const mes = hoy.getMonth() - nacimiento.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
        edad--;
    }

    return edad;
};

export const completarPerfil = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const { nombre, telefono, fechaNacimiento, genero } = req.body;

        const edad = calcularEdad(fechaNacimiento);

        const usuario = await userAppService.updateByUid(uid, {
            nombre,
            telefono,
            fechaNacimiento,
            genero,
            edad,
            perfilCompleto: true
        });

        return res.status(200).json({
            success: true,
            data: usuario
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error completando perfil"
        });
    }
};

const SEASON_PASS_ACTOR_ID = "season-pass-verifier";
const SEASON_PASS_SEASON_KEY = "apertura-2026";
const SEASON_PASS_PHONE_CLAIMS = "seasonPassPhoneClaims";
const SEASON_PASS_ITEM_CLAIMS = "seasonPassItemClaims";

const buildSeasonPassId = (uid: string) =>
    `season-pass:ap26:${uid}`;

const buildSeasonPassItemId = (uid: string, itemKeys: string[]) =>
    `${buildSeasonPassId(uid)}:${createHash("sha256")
        .update(itemKeys.slice().sort().join("|"))
        .digest("hex")}`;

const buildClaimDocId = (value: string) =>
    createHash("sha256").update(value).digest("hex");

const buildPhoneClaimId = (phone: string) =>
    buildClaimDocId(`${SEASON_PASS_SEASON_KEY}:phone:${phone}`);

const buildItemClaimId = (itemKey: string) =>
    buildClaimDocId(`${SEASON_PASS_SEASON_KEY}:item:${itemKey}`);

const seasonPassActor = {
    actorType: LoyaltyActorType.SERVICE,
    actorId: SEASON_PASS_ACTOR_ID,
    roles: ["SERVICE"],
    permissions: [],
};

const buildVerificationRecord = (
    result: SeasonPassVerificationResult,
    verifiedAt: FirebaseFirestore.Timestamp,
    pointsTransactionId?: string,
) => {
    const record = {
        isSubscriber: result.isSubscriber,
        season: result.season,
        event: result.event,
        phone: result.phone,
        phoneVerified: result.phoneVerified,
        purchaseCount: result.purchaseCount,
        totalBasePrice: result.totalBasePrice,
        pointsAwarded: result.pointsAwarded,
        purchaseIds: result.purchaseIds,
        itemKeys: result.itemKeys,
        verifiedAt,
    };

    return pointsTransactionId
        ? { ...record, pointsTransactionId }
        : record;
};

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter((item) => item.length > 0)
        : [];

const getLinkedSeasonPassPhone = (
    verification: Record<string, unknown> | undefined,
): string | null => {
    if (!verification || verification.isSubscriber !== true) {
        return null;
    }

    const phone = typeof verification.phone === "string"
        ? verification.phone.trim()
        : "";
    return phone.length > 0 ? phone : null;
};

const lastTwoDigits = (phone: string): string => {
    const digits = phone.replace(/\D/g, "");
    return digits.slice(-2).padStart(2, "*");
};

const maskedPhone = (phone: string): string =>
    `****${lastTwoDigits(phone)}`;

const emptySeasonPassVerification = (input: {
    phone: string;
    phoneVerified: boolean;
    message?: string;
}) => ({
    isSubscriber: false,
    season: "Apertura 2026",
    event: "Fierabono AP26",
    phone: maskedPhone(input.phone),
    phoneVerified: input.phoneVerified,
    purchaseCount: 0,
    totalBasePrice: 0,
    pointsAwarded: 0,
    purchaseIds: [],
    itemKeys: [],
    newItemsCount: 0,
    newItemsBasePrice: 0,
    newPointsAwarded: 0,
    totalPointsAwarded: 0,
    ...(input.message ? { message: input.message } : {}),
});

const claimSeasonPassItems = async (input: {
    uid: string;
    phone: string;
    items: SeasonPassPurchaseSummary[];
    existingRedeemedItemKeys: string[];
}) => {
    const phoneClaimRef = firestoreApp
        .collection(SEASON_PASS_PHONE_CLAIMS)
        .doc(buildPhoneClaimId(input.phone));
    const itemClaimRefs = input.items.map((item) => ({
        item,
        ref: firestoreApp
            .collection(SEASON_PASS_ITEM_CLAIMS)
            .doc(buildItemClaimId(item.itemKey)),
    }));
    const existingRedeemedSet = new Set(input.existingRedeemedItemKeys);
    const now = admin.firestore.Timestamp.now();

    return firestoreApp.runTransaction(async (tx) => {
        const phoneSnap = await tx.get(phoneClaimRef);
        if (phoneSnap.exists) {
            const claimedBy = phoneSnap.data()?.uid;
            if (claimedBy && claimedBy !== input.uid) {
                return {
                    blockedByUid: String(claimedBy),
                    claimedItems: [] as SeasonPassPurchaseSummary[],
                    redeemedItemKeys: input.existingRedeemedItemKeys,
                    createdPhoneClaim: false,
                    createdItemClaimIds: [] as string[],
                };
            }
        }

        const itemSnaps: Array<{
            item: SeasonPassPurchaseSummary;
            ref: FirebaseFirestore.DocumentReference;
            snap: FirebaseFirestore.DocumentSnapshot;
        }> = [];

        for (const { item, ref } of itemClaimRefs) {
            itemSnaps.push({
                item,
                ref,
                snap: await tx.get(ref),
            });
        }

        if (!phoneSnap.exists) {
            tx.create(phoneClaimRef, {
                uid: input.uid,
                phone: input.phone,
                season: "Apertura 2026",
                source: "boletomovil",
                createdAt: now,
                updatedAt: now,
            });
        }

        const claimedItems: SeasonPassPurchaseSummary[] = [];
        const redeemedItemKeys = new Set(input.existingRedeemedItemKeys);
        const createdItemClaimIds: string[] = [];

        for (const { item, ref, snap } of itemSnaps) {
            if (snap.exists) {
                const claimedBy = snap.data()?.uid;
                if (claimedBy === input.uid) {
                    redeemedItemKeys.add(item.itemKey);
                }
                continue;
            }

            tx.create(ref, {
                uid: input.uid,
                phone: input.phone,
                season: "Apertura 2026",
                event: item.event,
                itemKey: item.itemKey,
                purchaseID: item.purchaseID,
                zone: item.zone,
                section: item.section,
                seat: item.seat,
                basePrice: item.basePrice,
                legacyRedeemed: existingRedeemedSet.has(item.itemKey),
                createdAt: now,
                updatedAt: now,
            });

            redeemedItemKeys.add(item.itemKey);
            createdItemClaimIds.push(ref.id);
            if (!existingRedeemedSet.has(item.itemKey)) {
                claimedItems.push(item);
            }
        }

        return {
            blockedByUid: null,
            claimedItems,
            redeemedItemKeys: Array.from(redeemedItemKeys),
            createdPhoneClaim: !phoneSnap.exists,
            createdItemClaimIds,
        };
    });
};

const cleanupSeasonPassClaims = async (input: {
    phone: string;
    createdPhoneClaim: boolean;
    createdItemClaimIds: string[];
}) => {
    const batch = firestoreApp.batch();
    if (input.createdPhoneClaim) {
        batch.delete(
            firestoreApp
                .collection(SEASON_PASS_PHONE_CLAIMS)
                .doc(buildPhoneClaimId(input.phone)),
        );
    }
    for (const claimId of input.createdItemClaimIds) {
        batch.delete(firestoreApp.collection(SEASON_PASS_ITEM_CLAIMS).doc(claimId));
    }
    await batch.commit();
};

const markSeasonPassClaimsRedeemed = async (input: {
    itemKeys: string[];
    pointsTransactionId: string;
}) => {
    const batch = firestoreApp.batch();
    const now = admin.firestore.Timestamp.now();
    for (const itemKey of input.itemKeys) {
        batch.set(
            firestoreApp.collection(SEASON_PASS_ITEM_CLAIMS).doc(buildItemClaimId(itemKey)),
            {
                pointsTransactionId: input.pointsTransactionId,
                redeemedAt: now,
                updatedAt: now,
            },
            { merge: true },
        );
    }
    await batch.commit();
};

const serializeVerificationRecord = (
    verification: Record<string, unknown>,
    alreadyVerified: boolean,
) => {
    const verifiedAt = verification.verifiedAt;
    return {
        ...verification,
        phone: typeof verification.phone === "string"
            ? maskedPhone(verification.phone)
            : verification.phone,
        alreadyVerified,
        verifiedAt:
            verifiedAt instanceof admin.firestore.Timestamp
                ? verifiedAt.toDate().toISOString()
                : verifiedAt,
    };
};

const getUserDocumentByUid = async (uid: string) => {
    const directRef = firestoreApp.collection("usuariosApp").doc(uid);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
        return { ref: directRef, snap: directSnap };
    }

    const snapshot = await firestoreApp
        .collection("usuariosApp")
        .where("uid", "==", uid)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const snap = snapshot.docs[0];
    return { ref: snap.ref, snap };
};

export const verifySeasonPass = async (req: Request, res: Response) => {
    try {
        const uid = req.user?.uid;
        const verifiedPhone = req.firebaseAuth?.phoneNumber?.trim() ?? "";

        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "No autorizado. Token requerido",
                code: "AUTH_TOKEN_REQUIRED",
            });
        }

        if (!verifiedPhone) {
            return res.status(403).json({
                success: false,
                message:
                    "Verifica tu teléfono por SMS para consultar tus beneficios de abonado.",
                code: "PHONE_NOT_VERIFIED",
            });
        }

        const phone = seasonPassVerificationService.normalizePhone(verifiedPhone);

        const userDocument = await getUserDocumentByUid(uid);
        if (!userDocument) {
            return res.status(404).json({
                success: false,
                message: "Usuario no encontrado",
            });
        }

        const existingVerification = userDocument.snap.data()
            ?.seasonPassVerification as Record<string, unknown> | undefined;
        const linkedPhone = getLinkedSeasonPassPhone(existingVerification);
        if (linkedPhone) {
            const normalizedLinkedPhone =
                seasonPassVerificationService.normalizePhone(linkedPhone);

            if (phone !== normalizedLinkedPhone) {
                return res.status(409).json({
                    success: false,
                    message:
                        `Esta cuenta ya tiene el número ${maskedPhone(normalizedLinkedPhone)} asociado.`,
                    code: "PHONE_ALREADY_LINKED",
                    data: {
                        verification: serializeVerificationRecord(
                            {
                                ...existingVerification,
                                newItemsCount: 0,
                                newItemsBasePrice: 0,
                                newPointsAwarded: 0,
                                pointsAwarded: 0,
                            },
                            true,
                        ),
                    },
                });
            }
        }

        const verification = {
            ...(await seasonPassVerificationService.verifyByPhone(phone)),
            phoneVerified: true,
        };

        if (!verification.isSubscriber) {
            return res.status(404).json({
                success: false,
                message:
                    "No encontramos Fierabono AP26 para el teléfono verificado.",
                code: "SUBSCRIBER_NOT_FOUND",
                data: {
                    verification: emptySeasonPassVerification({
                        phone,
                        phoneVerified: true,
                    }),
                },
            });
        }

        const now = admin.firestore.Timestamp.now();
        let pointsTransactionId: string | undefined;
        let puntosActuales: number | undefined;
        let newItemsCount = 0;
        let newItemsBasePrice = 0;
        let newPointsAwarded = 0;
        let redeemedItemKeys = Array.from(
            new Set([
                ...asStringArray(existingVerification?.redeemedItemKeys),
                ...asStringArray(existingVerification?.itemKeys),
            ]),
        );

        if (verification.isSubscriber && verification.pointsAwarded > 0) {
            const claimResult = await claimSeasonPassItems({
                uid,
                phone: verification.phone,
                items: verification.items,
                existingRedeemedItemKeys: redeemedItemKeys,
            });

            if (claimResult.blockedByUid) {
                const blockedRecord = {
                    ...buildVerificationRecord(verification, now),
                    isSubscriber: false,
                    redeemedItemKeys,
                    newItemsCount: 0,
                    newItemsBasePrice: 0,
                    newPointsAwarded: 0,
                    pointsAwarded: 0,
                    totalPointsAwarded: Number(
                        existingVerification?.totalPointsAwarded ?? 0,
                    ),
                };

                return res.status(409).json({
                    success: false,
                    message:
                        `El número ${maskedPhone(verification.phone)} ya está vinculado a otra cuenta.`,
                    code: "PHONE_ALREADY_LINKED",
                    data: {
                        verification: serializeVerificationRecord(
                            blockedRecord,
                            false,
                        ),
                    },
                });
            }

            redeemedItemKeys = claimResult.redeemedItemKeys;
            const newItems = claimResult.claimedItems;
            newItemsCount = newItems.length;
            newItemsBasePrice = newItems.reduce(
                (sum, item) => sum + item.basePrice,
                0,
            );
            newPointsAwarded = Math.round(newItemsBasePrice * 0.1);

            if (newPointsAwarded <= 0) {
                redeemedItemKeys = Array.from(
                    new Set([...redeemedItemKeys, ...verification.itemKeys]),
                );
            } else {
                const idempotencyKey = buildSeasonPassItemId(
                    uid,
                    newItems.map((item) => item.itemKey),
                );
                try {
                    const transaction = await loyaltyEngineService.applyAdjustment({
                        memberId: uid,
                        points: newPointsAwarded,
                        reasonCode: "SEASON_PASS_AP26",
                        description:
                            `Bono Fierabono AP26 por ${newItemsCount} abono(s) nuevo(s)`,
                        externalReference: idempotencyKey,
                        idempotencyKey,
                        actor: seasonPassActor,
                    });
                    pointsTransactionId = transaction.transactionId;
                    puntosActuales = transaction.balanceAfter;
                    await markSeasonPassClaimsRedeemed({
                        itemKeys: newItems.map((item) => item.itemKey),
                        pointsTransactionId,
                    });
                } catch (error) {
                    await cleanupSeasonPassClaims({
                        phone: verification.phone,
                        createdPhoneClaim: claimResult.createdPhoneClaim,
                        createdItemClaimIds: claimResult.createdItemClaimIds,
                    });
                    throw error;
                }
            }
        }

        const record = buildVerificationRecord(
            verification,
            now,
            pointsTransactionId,
        );
        const finalRecord = {
            ...record,
            redeemedItemKeys,
            newItemsCount,
            newItemsBasePrice,
            newPointsAwarded,
            pointsAwarded: newPointsAwarded,
            totalPointsAwarded: Number(existingVerification?.totalPointsAwarded ?? 0) +
                newPointsAwarded,
        };

        await userDocument.ref.set(
            {
                seasonPassVerification: finalRecord,
                updatedAt: now,
            },
            { merge: true },
        );

        return res.status(200).json({
            success: true,
            message: verification.isSubscriber
                ? newPointsAwarded > 0
                    ? "Fierabono AP26 verificado correctamente."
                    : "No hay abonos nuevos. Puntos canjeados: 0."
                : "No encontramos Fierabono AP26 para ese teléfono.",
            data: {
                verification: serializeVerificationRecord(finalRecord, false),
                puntosActuales,
            },
        });
    } catch (error) {
        if (error instanceof SeasonPassVerificationError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }

        console.error("Error verificando Fierabono AP26:", {
            message: error instanceof Error ? error.message : "Error desconocido",
        });

        return res.status(500).json({
            success: false,
            message: "Error al verificar tu Fierabono AP26",
        });
    }
};



export const remove = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await userAppService.deleteUser(id);
        return res.status(200).json({
            success: true,
            message: "Usuario eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error en DELETE /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al eliminar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const reactivate = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Opcional: verificar permisos (solo SUPER_ADMIN o ADMIN)
        // if (req.user.rol !== 'SUPER_ADMIN' && req.user.rol !== 'ADMIN') {
        //   return res.status(403).json({ success: false, message: 'No tienes permisos' });
        // }

        const usuarioReactivado = await userAppService.reactivateUser(id);
        return res.status(200).json({
            success: true,
            message: 'Usuario reactivado exitosamente',
            data: usuarioReactivado,
        });
    } catch (error) {
        const statusCode = error instanceof Error && error.message.includes('no encontrado') ? 404 : 500;
        return res.status(statusCode).json({
            success: false,
            message: 'Error al reactivar el usuario',
            error: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
};

export const sumarPuntos = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const puntosASumar = 5;
        const usuario = await pointsService.addPoints(uid, puntosASumar, {
            origen: "promo",
            descripcion: "Bonificación automática por interacción",
        });
        return res.status(200).json({
            success: true,
            puntos: usuario.puntosActuales,
        });
    } catch (error) {
        console.error("Error al sumar puntos:", error);
        return res.status(500).json({ success: false, message: "Error interno" });
    }
};


//Eliminación de cuenta por parte del usuario (solicitud de eliminación)
export const solicitarEliminacionCuenta = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;

        // Verificar si ya existe una solicitud pendiente
        const usuario = await userAppService.getUserByUid(uid);
        if (usuario?.solicitudEliminacion?.estado === "pendiente") {
            return res.status(400).json({
                success: false,
                message: "Ya tienes una solicitud de eliminación pendiente. Puedes cancelarla si cambias de opinión.",
            });
        }

        const now = admin.firestore.Timestamp.now();
        // 30 días en milisegundos
        const fechaProgramada = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        );

        const solicitud = {
            fechaSolicitud: now,
            fechaProgramada,
            estado: "pendiente" as const,
        };

        await userAppService.updateByUid(uid, {
            solicitudEliminacion: solicitud,
        });

        return res.status(200).json({
            success: true,
            message: "Solicitud de eliminación de cuenta registrada. Tu cuenta será eliminada permanentemente en 30 días. Puedes cancelar la solicitud en cualquier momento antes de esa fecha.",
            fechaProgramada: fechaProgramada.toDate().toISOString(),
        });
    } catch (error) {
        console.error("Error al solicitar eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al procesar la solicitud",
        });
    }
};

export const cancelarEliminacionCuenta = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const usuario = await userAppService.getUserByUid(uid);
        if (!usuario) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        if (!usuario.solicitudEliminacion || usuario.solicitudEliminacion.estado !== "pendiente") {
            return res.status(400).json({
                success: false,
                message: "No hay una solicitud de eliminación pendiente",
            });
        }

        // Eliminar el campo solicitudEliminacion (se puede borrar completamente o cambiar estado a cancelada)
        await userAppService.updateByUid(uid, {
            solicitudEliminacion: admin.firestore.FieldValue.delete(),
        });

        return res.status(200).json({
            success: true,
            message: "Solicitud de eliminación cancelada. Tu cuenta permanecerá activa sin cambios.",
        });
    } catch (error) {
        console.error("Error al cancelar eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al cancelar la solicitud",
        });
    }
};

export const obtenerEstadoEliminacion = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user.uid;
        const usuario = await userAppService.getUserByUid(uid);
        if (!usuario) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        const solicitud = usuario.solicitudEliminacion;
        if (!solicitud || solicitud.estado !== "pendiente") {
            return res.status(200).json({
                success: true,
                tieneSolicitudPendiente: false,
            });
        }

        const ahora = Date.now();
        const fechaProgramadaMs = solicitud.fechaProgramada.toDate().getTime();
        const diasRestantes = Math.max(0, Math.ceil((fechaProgramadaMs - ahora) / (1000 * 60 * 60 * 24)));

        return res.status(200).json({
            success: true,
            tieneSolicitudPendiente: true,
            fechaSolicitud: solicitud.fechaSolicitud.toDate().toISOString(),
            fechaProgramada: solicitud.fechaProgramada.toDate().toISOString(),
            diasRestantes,
        });
    } catch (error) {
        console.error("Error al obtener estado de eliminación:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener el estado",
        });
    }
};