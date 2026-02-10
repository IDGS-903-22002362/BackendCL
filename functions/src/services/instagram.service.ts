// services/instagram.service.ts

const TOKEN = process.env.INSTAGRAM_TOKEN!;
const IG_USER_ID = process.env.INSTAGRAM_IG_USER_ID!;

export async function obtenerPostsInstagram() {
    const { data } = await axios.get(
        `${IG_BASE}/${IG_USER_ID}/media`,
        {
            params: {
                fields:
                    "id,caption,media_type,media_url,permalink,timestamp",
                access_token: TOKEN,
            },
        }
    );

    return data.data;
}

import axios from "axios";

const IG_BASE = "https://graph.facebook.com/v19.0";

class InstagramService {
    async obtenerPublicaciones() {
        const igUserId = process.env.IG_BUSINESS_ID!;
        const token = process.env.META_PAGE_TOKEN!;

        const { data } = await axios.get(`${IG_BASE}/${igUserId}/media`, {
            params: {
                fields: "id,caption,media_type,media_url,permalink,timestamp",
                access_token: token,
            },
        });

        return data.data;
    }
}

export default new InstagramService();
