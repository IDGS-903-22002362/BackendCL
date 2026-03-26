export interface SyncDocument {
  idTemporada: number;
  idTorneo: number;
  idDivision: number;

  torneo: string;

  calendario: any[];
  clasificacion: any[];

  updatedAt: FirebaseFirestore.Timestamp;
}