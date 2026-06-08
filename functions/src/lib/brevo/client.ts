// src/lib/brevo/client.ts - Versión con axios
import axios from 'axios';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@clubleon.com';
const senderName = process.env.BREVO_SENDER_NAME || 'Club León';

export async function sendVerificationEmail(to: string, code: string, nombre?: string) {
    if (!BREVO_API_KEY) {
        console.error(' Brevo no configurado - API key faltante');
        return false;
    }

    try {
        await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            {
                sender: { email: senderEmail, name: senderName },
                to: [{ email: to, name: nombre || 'Usuario' }],
                subject: 'Código de verificación - Club León',
                htmlContent: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #007A53; padding: 20px; text-align: center; }
              .header h1 { color: white; margin: 0; }
              .content { padding: 30px; background-color: #f9f9f9; }
              .code { font-size: 32px; font-weight: bold; text-align: center; padding: 20px; 
                      background-color: #007A53; color: white; border-radius: 10px; 
                      letter-spacing: 5px; margin: 20px 0; }
              .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Club León</h1>
              </div>
              <div class="content">
                <h2>¡Hola ${nombre || 'usuario'}!</h2>
                <p>Hemos recibido una solicitud para iniciar sesión en tu cuenta. Para continuar, utiliza el siguiente código de verificación:</p>
                <div class="code">${code}</div>
                <p>Este código es válido por <strong>10 minutos</strong>. Si no solicitaste este código, puedes ignorar este mensaje.</p>
                <p>¡Gracias por ser parte de la familia esmeralda! </p>
              </div>
              <div class="footer">
                <p>Club León - Pasión que nos une 💚</p>
                <p>© ${new Date().getFullYear()} Club León. Todos los derechos reservados.</p>
              </div>
            </div>
          </body>
          </html>
        `,
                textContent: `
          Hola ${nombre || 'usuario'},
          
          Tu código de verificación para iniciar sesión en Club León es: ${code}
          
          Este código es válido por 10 minutos.
          
          Si no solicitaste este código, ignora este mensaje.
          
          ---
          Club León - Pasión que nos une
        `
            },
            {
                headers: {
                    'api-key': BREVO_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Email enviado exitosamente');
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email:', error);
        return false;
    }
}