import type { RequestHandler } from 'express';
import { ModerationStatus } from '../generated/prisma/client.js';
import * as admin from '../services/admin.service.js';

export const analytics: RequestHandler = async (req, res) => res.json({ data: await admin.analytics(Number(req.query.months ?? 6)) });
export const haats: RequestHandler = async (_req, res) => res.json({ data: await admin.listHaats() });
export const saveHaat: RequestHandler = async (req, res) => res.status(req.params.id ? 200 : 201).json({ data: await admin.saveHaat(req.params.id ? String(req.params.id) : undefined, req.body) });
export const toggleHaat: RequestHandler = async (req, res) => res.json({ data: await admin.toggleHaat(String(req.params.id), req.body.enabled) });
export const liveHaat: RequestHandler = async (req, res) => res.status(201).json({ data: await admin.setLiveHaat(String(req.params.id), new Date(req.body.liveUntil)) });
export const abandonedCarts: RequestHandler = async (_req, res) => res.json({ data: await admin.abandonedCarts() });
export const reminderOpened: RequestHandler = async (req, res) => res.json({ data: await admin.reminderOpened(String(req.params.id)) });
export const applications: RequestHandler = async (_req, res) => res.json({ data: await admin.applications() });
export const moderate: RequestHandler = async (req, res) => res.json({ data: await admin.moderate(req.auth!.userId, req.requestId, String(req.params.id), req.body.status as ModerationStatus, req.body.reason) });
