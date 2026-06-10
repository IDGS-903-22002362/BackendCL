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
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Código de Verificación - Club León</title>
              <style>
                body { 
                  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                  line-height: 1.6; 
                  color: #2D3748; 
                  background-color: #f4f6f8; 
                  margin: 0; 
                  padding: 0;
                  -webkit-font-smoothing: antialiased;
                }
                .wrapper {
                  background-color: #f4f6f8;
                  width: 100%;
                  padding: 40px 0;
                }
                .container { 
                  max-width: 550px; 
                  margin: 0 auto; 
                  background-color: #ffffff;
                  border-radius: 16px;
                  overflow: hidden;
                  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
                }
                .header { 
                  background: linear-gradient(135deg, #006341 0%, #007A53 100%); 
                  padding: 10px 20px; 
                  text-align: center; 
                  border-bottom: 4px solid #D4AF37; /* Detalle Dorado Elegante */
                }
                .header img {
                  margin-bottom: 10px;
                  filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.2));
                }
                .header h1 { 
                  color: #ffffff; 
                  margin: 0; 
                  font-size: 24px;
                  font-weight: 700;
                  letter-spacing: 1px;
                  text-transform: uppercase;
                }
                .content { 
                  padding: 40px 35px; 
                  background-color: #ffffff; 
                }
                .content h2 {
                  color: #007A53;
                  margin-top: 0;
                  font-size: 22px;
                  font-weight: 700;
                }
                .content p {
                  font-size: 15px;
                  color: #4A5568;
                  margin-bottom: 25px;
                }
                .code-container {
                  text-align: center;
                  margin: 35px 0;
                }
                .code { 
                  display: inline-block;
                  font-family: 'Courier New', Courier, monospace;
                  font-size: 36px; 
                  font-weight: bold; 
                  padding: 16px 40px; 
                  background-color: #F0Fdf4; 
                  color: #007A53; 
                  border: 2px dashed #007A53;
                  border-radius: 12px; 
                  letter-spacing: 6px; 
                }
                .note {
                  font-size: 13px;
                  color: #718096;
                  background-color: #F7FAFC;
                  padding: 12px 15px;
                  border-left: 3px solid #CBD5E0;
                  border-radius: 0 4px 4px 0;
                  margin-top: 30px;
                }
                .signature {
                  margin-top: 30px;
                  font-weight: 600;
                  color: #007A53;
                }
                .footer { 
                  text-align: center; 
                  padding: 30px 20px; 
                  font-size: 12px; 
                  color: #A0AEC0; 
                }
                .footer p {
                  margin: 5px 0;
                }
                .motto {
                  font-weight: bold;
                  color: #718096;
                  text-transform: uppercase;
                  letter-spacing: 1px;
                }
              </style>
            </head>
            <body>
              <div class="wrapper">
                <div class="container">
                  
                  <div class="header">
                    <img src="https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/galeria/e5a06d0a-9ca3-4864-b481-be2e7b0fa23a.png" alt="Club León Logo" width="60" />
                    <h1>Club León</h1>
                  </div>
                  
                  <div class="content">
                    <h2>¡Hola ${nombre || 'usuario'}!</h2>
                    <p>Hemos recibido una solicitud para iniciar sesión en tu cuenta de la App Oficial. Para continuar con el acceso, ingresa el siguiente código de verificación:</p>
                    
                    <div class="code-container">
                      <div class="code">${code}</div>
                    </div>
                    
                    <div class="note">
                      Este código es válido solamente por <strong>10 minutos</strong>. Si tú no solicitaste este movimiento, puedes ignorar este mensaje de forma segura.
                    </div>
                    
                    <p class="signature">¡Gracias por ser parte de la familia esmeralda!</p>
                  </div>
                  
                  <div class="footer">
                    <p class="motto">Ser Fiera Es Un Orgullo</p>
                    <p>© ${new Date().getFullYear()} Club León. Todos los derechos reservados.</p>
                  </div>
                  
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

    console.log(' Email enviado exitosamente');
    return true;
  } catch (error) {
    console.error(' Error al enviar email:', error);
    return false;
  }
}