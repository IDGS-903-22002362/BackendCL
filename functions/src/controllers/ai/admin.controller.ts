import { Request, Response } from "express";
import aiAdminService from "../../services/ai/ai-admin.service";

export const getMetrics = async (_req: Request, res: Response) => {
  const metrics = await aiAdminService.getMetrics();
  return res.status(200).json({ success: true, data: metrics });
};

export const listJobs = async (_req: Request, res: Response) => {
  const jobs = await aiAdminService.listRecentJobs();
  return res.status(200).json({ success: true, count: jobs.length, data: jobs });
};
