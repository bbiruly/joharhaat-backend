import type { RequestHandler } from 'express';
import type { ProductSearchInput } from '../schemas/product-search.schema.js';
import { searchProducts } from '../services/product-search.service.js';

export const productSearchController: RequestHandler = async (request, response) => {
  response.json({ data: await searchProducts(request.query as unknown as ProductSearchInput) });
};
