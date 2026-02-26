// src/models/racha.model.ts

export interface RachaUsuario {
  streakCount: number;        // racha actual
  streakBest: number;         // mejor racha histórica
  streakLastDay: string | null; // "YYYY-MM-DD" del último check-in
  streakUpdatedAt?: any;      // Timestamp Firestore (admin.firestore.Timestamp)
}

export interface RachaCheckInResult {
  todayKey: string;           
  alreadyCheckedIn: boolean; 
  streakCount: number;
  streakBest: number;
}