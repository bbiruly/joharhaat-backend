export function addressDeletionPlan(input: {
  referencedByOrder: boolean;
  isDefault: boolean;
  hasOtherActiveAddress: boolean;
}) {
  return {
    archive: input.referencedByOrder,
    promoteNextDefault: input.isDefault && input.hasOtherActiveAddress,
  };
}
