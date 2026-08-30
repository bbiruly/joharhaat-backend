import { PAGINATION } from '../config/constants.js';
export const pagination = (page: number, requestedSize: number) => { const pageSize = Math.min(requestedSize, PAGINATION.maxSize); return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }; };
