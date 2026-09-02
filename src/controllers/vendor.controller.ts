import type { RequestHandler } from 'express';
import { FulfillmentStatus } from '../generated/prisma/client.js';
import * as vendor from '../services/vendor.service.js';
import { mockObjectStorage } from '../services/storage.service.js';

export const dashboard: RequestHandler = async (req, res) => res.json({ data: await vendor.dashboard(req.auth!.userId) });
export const products: RequestHandler = async (req, res) => res.json({ data: await vendor.listProducts(req.auth!.userId) });
export const product: RequestHandler = async (req, res) => res.json({ data: await vendor.productDetail(req.auth!.userId, String(req.params.id)) });
export const createProduct: RequestHandler = async (req, res) => res.status(201).json({ data: await vendor.createProduct(req.auth!.userId, req.body) });
export const submitProduct: RequestHandler = async (req, res) => res.json({ data: await vendor.submitProduct(req.auth!.userId, String(req.params.id)) });
export const archiveProduct: RequestHandler = async (req, res) => res.json({ data: await vendor.archiveProduct(req.auth!.userId, String(req.params.id)) });
export const updateStock: RequestHandler = async (req, res) => res.json({ data: await vendor.updateStock(req.auth!.userId, String(req.params.id), req.body.stock, req.body.expectedVersion) });
export const transitionOrder: RequestHandler = async (req, res) => res.json({ data: await vendor.transitionOrder(req.auth!.userId, String(req.params.id), req.body.status as FulfillmentStatus) });
export const shippingLabel: RequestHandler = async (req, res) => res.json({ data: await vendor.shippingLabel(req.auth!.userId, String(req.params.id)) });
export const requestPayout: RequestHandler = async (req, res) => res.status(201).json({ data: await vendor.requestPayout(req.auth!.userId) });
export const submitApplication: RequestHandler = async (req, res) => res.status(201).json({ data: await vendor.submitApplication(req.auth!.userId, req.body) });
export const presignUpload: RequestHandler = async (req, res) => res.status(201).json({ data: await mockObjectStorage.createPresignedUpload(req.body) });
export const confirmUpload: RequestHandler = async (req, res) => res.json({ data: await mockObjectStorage.confirmUpload(req.body.objectKey) });
