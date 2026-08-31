import { PAGINATION } from '../config/constants.js';
export const pagination = (requestedPage?: number, requestedSize?: number) => {
  const page = Number.isInteger(requestedPage) && Number(requestedPage) > 0
    ? Number(requestedPage)
    : 1;
  const validSize = Number.isInteger(requestedSize) && Number(requestedSize) > 0
    ? Number(requestedSize)
    : PAGINATION.defaultSize;
  const pageSize = Math.min(validSize, PAGINATION.maxSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};
