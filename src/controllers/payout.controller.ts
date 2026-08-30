import type { RequestHandler } from 'express';
import { handleEscrowPayoutSplit } from '../services/payout.service.js';

export const payoutController: RequestHandler = async (request, response) => {
  const result = await handleEscrowPayoutSplit(String(request.params.vendorOrderId));
  response.status(200).json({ data: result });
};
