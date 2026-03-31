import { Timestamp } from "firebase-admin/firestore";

export enum EstadoPosSession {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
}

export interface PosSession {
  id?: string;
  deviceId: string;
  cajaId: string;
  sucursalId: string;
  vendedorUid: string;
  status: EstadoPosSession;
  metadata?: Record<string, unknown>;
  openedAt: Timestamp;
  closedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
