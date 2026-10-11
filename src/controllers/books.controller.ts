import type { RequestHandler } from 'express';
import * as books from '../services/books.service.js';

export const overview: RequestHandler = async (req, res) => res.json({ data: await books.booksOverview(req.auth!.userId) });
export const setup: RequestHandler = async (req, res) => res.status(201).json({ data: await books.setupBooks(req.auth!.userId, req.requestId, req.body.startDate) });
export const accounts: RequestHandler = async (req, res) => res.json({ data: await books.listAccounts(req.auth!.userId) });
export const createAccount: RequestHandler = async (req, res) => res.status(201).json({ data: await books.createAccount(req.auth!.userId, req.requestId, req.body) });
export const createParty: RequestHandler = async (req, res) => res.status(201).json({ data: await books.createParty(req.auth!.userId, req.requestId, req.body) });
export const createStockItem: RequestHandler = async (req, res) => res.status(201).json({ data: await books.createStockItem(req.auth!.userId, req.requestId, req.body) });
export const entry: RequestHandler = async (req, res) => res.status(201).json({ data: await books.postEntry(req.auth!.userId, req.requestId, req.body) });
export const reverseEntry: RequestHandler = async (req, res) => res.status(201).json({ data: await books.reverseEntry(req.auth!.userId, req.requestId, String(req.params.id), req.body.reason) });
export const closePeriod: RequestHandler = async (req, res) => res.status(201).json({ data: await books.closePeriod(req.auth!.userId, req.requestId, req.body.startsOn, req.body.endsOn) });
export const stockMovement: RequestHandler = async (req, res) => res.status(201).json({ data: await books.recordStockMovement(req.auth!.userId, req.requestId, req.body) });
export const bankReconciliation: RequestHandler = async (req, res) => res.status(201).json({ data: await books.reconcileBank(req.auth!.userId, req.requestId, req.body) });
export const reports: RequestHandler = async (req, res) => res.json({ data: await books.booksReports(req.auth!.userId, String(req.query.from), String(req.query.to)) });
