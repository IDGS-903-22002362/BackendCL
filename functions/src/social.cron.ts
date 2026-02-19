import { onSchedule } from "firebase-functions/v2/scheduler";
import { firestore } from "firebase-admin";
import instagramService from "./services/instagram.service";
import newService from "./services/new.service";

export const syncInstagramPosts = onSchedule("every 30 minutes", async () => {
  const posts = await instagramService.obtenerPublicaciones();
  const db = firestore();

  for (const post of posts) {
    const ref = db.collection("noticias").doc(`ig_${post.id}`);

    if ((await ref.get()).exists) continue;

    await ref.set({
      titulo: post.caption?.slice(0, 80) ?? "Publicación de Instagram",
      descripcion: "Publicación de Instagram",
      contenido: post.caption ?? "",
      imagenes: post.media_url ? [post.media_url] : [],
      enlaceExterno: post.permalink,
      origen: "instagram",
      estatus: true,
      createdAt: firestore.Timestamp.now(),
      updatedAt: firestore.Timestamp.now(),
    });
    await newService.generarIAParaNoticia(ref.id);
  }
});
