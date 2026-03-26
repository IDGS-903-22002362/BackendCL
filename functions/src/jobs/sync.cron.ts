import { onSchedule } from 'firebase-functions/v2/scheduler';
import { SyncService } from '../services/sync.service';

const syncService = new SyncService();

export const syncAllCron = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'America/Mexico_City',
  },
  async () => {
    try {
      await syncService.syncAll(77, 2, 1);
      console.log('✅ Sync ejecutado correctamente');
    } catch (error) {
      console.error('❌ Error en sync:', error);
    }
  }
);