import ordenService from "../../../services/orden.service";
import pagoService from "../../../services/pago.service";
import { RolUsuario } from "../../../models/usuario.model";

class OrderSupportService {
  async getOrderStatus(input: {
    orderId: string;
    userId?: string;
    role?: RolUsuario;
    phone?: string;
  }): Promise<Record<string, unknown> | null> {
    const order = await ordenService.getOrderStatusForAssistant({
      orderId: input.orderId,
      authUser:
        input.userId && input.role
          ? { uid: input.userId, rol: input.role }
          : undefined,
      phone: input.phone,
    });

    if (!order) {
      return null;
    }

    let paymentSummary: Record<string, unknown> | null = null;
    if (input.userId && input.role) {
      try {
        const payment = await pagoService.getPagoByOrdenId(input.orderId, {
          uid: input.userId,
          rol: input.role,
        });
        paymentSummary = {
          estado: payment.estado,
          metodoPago: payment.metodoPago,
          provider: payment.provider,
        };
      } catch (_error) {
        paymentSummary = null;
      }
    }

    return {
      ...order,
      payment: paymentSummary,
    };
  }
}

export const orderSupportService = new OrderSupportService();
export default orderSupportService;
