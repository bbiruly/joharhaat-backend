import { PayoutRequestStatus } from '../generated/prisma/client.js';
import { ApiError } from '../utils/api-error.js';

export const isPayoutRequestActive = (status: PayoutRequestStatus) => status === PayoutRequestStatus.PENDING || status === PayoutRequestStatus.PROCESSING;

export function assertPayoutCanProcess(status: PayoutRequestStatus) {
  if (status !== PayoutRequestStatus.PENDING && status !== PayoutRequestStatus.PROCESSING)
    throw new ApiError(409, 'Only pending payout requests can be processed.', 'PAYOUT_STATE_CONFLICT');
}

export function assertPayoutCanComplete(status: PayoutRequestStatus, settlementReference: string) {
  if (!settlementReference.trim() || settlementReference.trim().length < 4 || settlementReference.trim().length > 64)
    throw new ApiError(422, 'Enter a valid UTR or settlement reference.', 'PAYOUT_REFERENCE_REQUIRED');
  if (status !== PayoutRequestStatus.PROCESSING)
    throw new ApiError(409, 'Move the payout request to processing before completing it.', 'PAYOUT_STATE_CONFLICT');
}

export function assertPayoutCanReject(status: PayoutRequestStatus, reason: string) {
  if (!reason.trim() || reason.trim().length < 5 || reason.trim().length > 500)
    throw new ApiError(422, 'Enter a rejection reason between 5 and 500 characters.', 'PAYOUT_REJECTION_REASON_REQUIRED');
  if (!isPayoutRequestActive(status)) throw new ApiError(409, 'Only active payout requests can be rejected.', 'PAYOUT_STATE_CONFLICT');
}

export function isSettlementReplay(status: PayoutRequestStatus, storedReference: string | null, receivedReference: string) {
  return status === PayoutRequestStatus.COMPLETED && storedReference === receivedReference.trim();
}
