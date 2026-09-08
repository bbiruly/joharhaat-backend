import type { RequestHandler } from 'express';
import * as reviews from '../services/review.service.js';

/** Public: anyone can read a product's reviews. */
export const listForProduct: RequestHandler = async (req, res) =>
  res.json({ data: await reviews.listForProduct(String(req.params.id), req.query) });

/** Public: the rating summary alone, for a product card or listing. */
export const ratingFor: RequestHandler = async (req, res) =>
  res.json({ data: await reviews.ratingFor(String(req.params.id)) });

/** What this customer may still review on one of their delivered orders. */
export const reviewable: RequestHandler = async (req, res) =>
  res.json({ data: await reviews.reviewableProducts(req.auth!.userId, String(req.params.id)) });

export const create: RequestHandler = async (req, res) =>
  res.status(201).json({
    data: await reviews.createReview(
      req.auth!.userId,
      String(req.body.productId),
      String(req.body.orderId),
      { rating: req.body.rating, body: req.body.body, media: req.body.media },
    ),
  });

export const update: RequestHandler = async (req, res) =>
  res.json({
    data: await reviews.updateReview(req.auth!.userId, String(req.params.id), {
      rating: req.body.rating,
      body: req.body.body,
      media: req.body.media,
    }),
  });

export const remove: RequestHandler = async (req, res) =>
  res.json({ data: await reviews.deleteReview(req.auth!.userId, String(req.params.id)) });

export const report: RequestHandler = async (req, res) =>
  res.json({
    data: await reviews.reportReview(req.auth!.userId, String(req.params.id), String(req.body.reason)),
  });
