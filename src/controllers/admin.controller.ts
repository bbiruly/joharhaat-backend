import type { RequestHandler } from 'express';
import { AdminTeamRole, FulfillmentStatus, ModerationStatus } from '../generated/prisma/client.js';
import * as admin from '../services/admin.service.js';
import * as adminCustomer from '../services/admin-customer.service.js';
import * as adminTransaction from '../services/admin-transaction.service.js';

export const analytics: RequestHandler = async (req, res) => res.json({ data: await admin.analytics(req.auth!.userId, Number(req.query.months ?? 6)) });
export const haats: RequestHandler = async (req, res) => res.json({ data: await admin.listHaats(req.auth!.userId) });
export const saveHaat: RequestHandler = async (req, res) => res.status(req.params.id ? 200 : 201).json({ data: await admin.saveHaat(req.auth!.userId, req.params.id ? String(req.params.id) : undefined, req.body) });
export const toggleHaat: RequestHandler = async (req, res) => res.json({ data: await admin.toggleHaat(req.auth!.userId, String(req.params.id), req.body.enabled) });
export const liveHaat: RequestHandler = async (req, res) => res.status(201).json({ data: await admin.setLiveHaat(req.auth!.userId, String(req.params.id), new Date(req.body.liveUntil)) });
export const abandonedCarts: RequestHandler = async (req, res) => res.json({ data: await admin.abandonedCarts(req.auth!.userId) });
export const reminderOpened: RequestHandler = async (req, res) => res.json({ data: await admin.reminderOpened(req.auth!.userId, String(req.params.id)) });
export const applications: RequestHandler = async (req, res) => res.json({ data: await admin.applications(req.auth!.userId) });
export const moderate: RequestHandler = async (req, res) => res.json({ data: await admin.moderate(req.auth!.userId, req.requestId, String(req.params.id), req.body.status as ModerationStatus, req.body.reason) });
export const productsForModeration: RequestHandler = async (req, res) => res.json({ data: await admin.productsForModeration(req.auth!.userId) });
export const moderateProduct: RequestHandler = async (req, res) => res.json({ data: await admin.moderateProduct(req.auth!.userId, req.requestId, String(req.params.id), req.body.decision, req.body.reason) });
export const access: RequestHandler = async (req,res)=>res.json({data:await admin.adminAccess(req.auth!.userId)});
export const overview: RequestHandler = async (req,res)=>res.json({data:await admin.overview(req.auth!.userId)});
export const orders: RequestHandler = async (req,res)=>res.json({data:await admin.adminOrders(req.auth!.userId,req.query)});
export const correctOrderStatus: RequestHandler = async (req,res)=>res.json({data:await admin.correctOrderStatus(req.auth!.userId,req.requestId,String(req.params.id),req.body.status as FulfillmentStatus,req.body.reason)});
export const payouts: RequestHandler = async (req,res)=>res.json({data:await admin.payouts(req.auth!.userId)});
export const notifications: RequestHandler = async (req,res)=>res.json({data:await admin.notifications(req.auth!.userId)});
export const markNotification: RequestHandler = async (req,res)=>res.json({data:await admin.markNotification(req.auth!.userId,String(req.params.id))});
export const markAllNotifications: RequestHandler = async (req,res)=>res.json({data:await admin.markAllNotifications(req.auth!.userId)});
export const team: RequestHandler = async (req,res)=>res.json({data:await admin.team(req.auth!.userId)});
export const updateTeamMember: RequestHandler = async (req,res)=>res.json({data:await admin.updateTeamMember(req.auth!.userId,String(req.params.id),{...req.body,role:req.body.role as AdminTeamRole|undefined})});

// --- Customer directory + payment attempts -------------------------------
export const customers: RequestHandler = async (req, res) => res.json({ data: await adminCustomer.customers(req.auth!.userId, req.query) });
export const customer: RequestHandler = async (req, res) => res.json({ data: await adminCustomer.customer(req.auth!.userId, String(req.params.id)) });
export const revokeCustomerSessions: RequestHandler = async (req, res) => res.json({ data: await adminCustomer.revokeCustomerSessions(req.auth!.userId, req.requestId, String(req.params.id)) });
export const transactions: RequestHandler = async (req, res) => res.json({ data: await adminTransaction.transactions(req.auth!.userId, req.query) });
export const transaction: RequestHandler = async (req, res) => res.json({ data: await adminTransaction.transaction(req.auth!.userId, String(req.params.id)) });
