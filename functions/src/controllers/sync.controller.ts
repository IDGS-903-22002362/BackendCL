import { Request, Response } from 'express';
import { SyncService } from '../services/sync.service';

const service = new SyncService();

export const syncAll = async (req: Request, res: Response) => {
  try {
    const { idTemporada, idTorneo, idDivision } = req.body;

    const data = await service.syncAll(
      Number(idTemporada),
      Number(idTorneo),
      Number(idDivision)
    );

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};