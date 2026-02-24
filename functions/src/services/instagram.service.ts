import axios from "axios";

const IG_BASE = "https://graph.facebook.com/v24.0";

const IG_USER_ID = process.env.INSTAGRAM_USER_ID!;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN!;

class InstagramService {
    async obtenerPublicaciones() {
        console.log("IG_USER_ID:", IG_USER_ID);
        console.log("ACCESS_TOKEN:", ACCESS_TOKEN ? "OK" : "MISSING");

        try {
            const response = await axios.get(
                `${IG_BASE}/${IG_USER_ID}/media`,
                {
                    params: {
                        fields: "id,caption,media_type,media_url,permalink,timestamp",
                        access_token: ACCESS_TOKEN,
                    },
                }
            );

            console.log("Instagram response OK");
            return response.data.data;

        } catch (error: any) {
            console.error("Instagram API ERROR FULL:", error.response?.data);
            throw error;
        }
    }
}

export default new InstagramService();