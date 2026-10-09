import type { RequestHandler } from 'express';
import * as delivery from '../services/delivery.service.js';

export const lookupPincode: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.lookupDeliveryPincode(String(request.params.postalCode)) });
};

export const settings: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.deliverySettings(request.auth!.userId) });
};

export const updateSettings: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.updateDeliverySettings(request.auth!.userId, request.requestId, request.body) });
};

export const pincodes: RequestHandler = async (request, response) => {
  const query = request.query;
  response.json({ data: await delivery.listDeliveryPincodes(request.auth!.userId, {
    ...(typeof query.q === 'string' ? { q: query.q } : {}),
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 50,
    ...(query.serviceable === 'true' ? { serviceable: true } : query.serviceable === 'false' ? { serviceable: false } : {}),
  }) });
};

export const updatePincode: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.updateDeliveryPincode(request.auth!.userId, request.requestId, String(request.params.postalCode), request.body) });
};

export const importPincodes: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.importDeliveryPincodes(request.auth!.userId, request.requestId, String(request.body ?? '')) });
};

export const previewPincodes: RequestHandler = async (request, response) => {
  response.json({ data: await delivery.previewDeliveryPincodes(request.auth!.userId, String(request.body ?? '')) });
};

export const exportPincodes: RequestHandler = async (request, response) => {
  response.type('text/csv; charset=utf-8').attachment('joharhaat-delivery-pincodes.csv').send(await delivery.exportDeliveryPincodes(request.auth!.userId));
};

export const template: RequestHandler = async (request, response) => {
  response.type('text/csv; charset=utf-8').attachment('joharhaat-delivery-pincode-template.csv')
    .send(await delivery.deliveryPincodeTemplate(request.auth!.userId));
};
