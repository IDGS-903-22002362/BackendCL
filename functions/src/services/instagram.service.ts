// services/instagram.service.ts
import axios from "axios";

const IG_BASE = "https://graph.facebook.com/v24.0";

const IG_USER_ID = process.env.INSTAGRAM_USER_ID!;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN!;

class InstagramService {
    async obtenerPublicaciones() {
        if (!IG_USER_ID || !ACCESS_TOKEN) {
            throw new Error("Instagram env vars no definidas");
        }

        const { data } = await axios.get(
            `${IG_BASE}/${IG_USER_ID}/media`,
            {
                params: {
                    fields: "id,caption,media_type,media_url,permalink,timestamp",
                    access_token: ACCESS_TOKEN,
                },
            }
        );

        return data.data;
    }
}

export default new InstagramService();
