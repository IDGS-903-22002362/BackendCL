import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { Request, Response, NextFunction } from "express";

export const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {

    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
        res.status(401).json({ message: "No autorizado" });
        return;
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token);

        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("uid", "==", decoded.uid)
            .limit(1)
            .get();

        if (snapshot.empty) {
            res.status(404).json({ message: "Usuario no registrado" });
            return;
        }

        req.user = {
            ...decoded,
            ...snapshot.docs[0].data()
        };

        next();
        return;

    } catch {
        res.status(401).json({ message: "Token inválido" });
        return;
    }
};
