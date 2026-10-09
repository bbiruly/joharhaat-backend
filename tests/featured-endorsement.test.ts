import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');

describe('featured endorsement access and publication', () => {
  it('gates admin operations with marketing permission and records each state change', () => {
    const service = source('services/featured-endorsement.service.ts');
    expect(service.match(/adminAccess\(userId, 'marketing:manage'\)/g)).toHaveLength(6);
    for (const event of ['ENDORSEMENT_CREATED', 'ENDORSEMENT_UPDATED', 'ENDORSEMENT_PUBLISHED', 'ENDORSEMENT_UNPUBLISHED', 'ENDORSEMENT_ARCHIVED'])
      expect(service).toContain(event);
    expect(service).toContain('writeAudit(prisma');
  });

  it('public route selects only published content-safe fields', () => {
    const service = source('services/featured-endorsement.service.ts');
    const publicQuery = service.slice(service.indexOf('export async function listPublicEndorsements'), service.indexOf('export async function presignEndorsementUpload'));
    expect(publicQuery).toContain("status: FeaturedEndorsementStatus.PUBLISHED");
    expect(publicQuery).toContain('displayName: true');
    expect(publicQuery).not.toContain('identityConfirmedAt');
    expect(publicQuery).not.toContain('confirmedById');
  });

  it('accepts the endorsement category sent by the shared presign client', () => {
    const routes = source('routes/api.ts');
    const endorsementUploadRoute = routes.slice(routes.indexOf("'/admin/endorsements/uploads/presign'"));
    expect(endorsementUploadRoute.split('\n')[0]).toContain("category: z.literal('endorsement')");
  });
});
