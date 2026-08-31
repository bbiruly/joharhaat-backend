import type { RequestHandler } from 'express';
import * as customer from '../services/customer.service.js';

export const me: RequestHandler = async (req, res) => res.json({ data: await customer.getProfile(req.auth!.userId) });
export const updateMe: RequestHandler = async (req, res) => res.json({ data: await customer.updateProfile(req.auth!.userId, req.body) });
export const addresses: RequestHandler = async (req, res) => res.json({ data: await customer.listAddresses(req.auth!.userId) });
export const createAddress: RequestHandler = async (req, res) => res.status(201).json({ data: await customer.saveAddress(req.auth!.userId, undefined, req.body) });
export const updateAddress: RequestHandler = async (req, res) => res.json({ data: await customer.saveAddress(req.auth!.userId, String(req.params.id), req.body) });
export const deleteAddress: RequestHandler = async (req, res) => { await customer.deleteAddress(req.auth!.userId, String(req.params.id)); res.status(204).end(); };
export const defaultAddress: RequestHandler = async (req, res) => res.json({ data: await customer.setDefaultAddress(req.auth!.userId, String(req.params.id)) });
export const cart: RequestHandler = async (req, res) => res.json({ data: await customer.getCart(req.auth!.userId) });
export const addCartItem: RequestHandler = async (req, res) => res.status(201).json({ data: await customer.addCartItem(req.auth!.userId, req.body.variantId, req.body.quantity) });
export const updateCartItem: RequestHandler = async (req, res) => res.json({ data: await customer.updateCartItem(req.auth!.userId, String(req.params.id), req.body.quantity) });
export const removeCartItem: RequestHandler = async (req, res) => res.json({ data: await customer.removeCartItem(req.auth!.userId, String(req.params.id)) });
export const wishlist: RequestHandler = async (req, res) => res.json({ data: await customer.listWishlist(req.auth!.userId) });
export const toggleWishlist: RequestHandler = async (req, res) => res.json({ data: await customer.toggleWishlist(req.auth!.userId, String(req.params.id)) });
export const orders: RequestHandler = async (req, res) => res.json({ data: await customer.listOrders(req.auth!.userId) });
export const order: RequestHandler = async (req, res) => res.json({ data: await customer.getOrder(req.auth!.userId, String(req.params.id)) });
