import type { EntitlementService } from '../subscription-plans/entitlements';
import { WorkforceService } from './workforce.service';
import { WorkforceMapper } from './workforce.mapper';
import { ProfessionalSignatoryPolicy } from './professional-signatory.policy';

/** Estes testes são sobre elegibilidade profissional, não sobre cota. */
const semCota = {
  guardAllocation: <T>(_o: string, _r: string, work: () => Promise<T>) =>
    work(),
} as unknown as EntitlementService;

describe('Professional roles and eligibility', () => {
  const profile = (
    field: boolean,
    responsible: boolean,
    credential = false,
  ) => ({
    id: 'profile',
    organizationId: 'org',
    userId: 'user',
    fieldTechnicianEnabled: field,
    technicalResponsibleEnabled: responsible,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { displayName: 'Ana', status: 'ACTIVE', deletedAt: null },
    organization: { id: 'org' },
    credentials: credential
      ? [
          {
            id: 'credential',
            organizationId: 'org',
            professionalProfileId: 'profile',
            userId: 'user',
            type: 'CREA',
            registrationNumber: '123',
            region: 'PE',
            issuingAuthority: null,
            displayLabel: null,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            revokedAt: null,
          },
        ]
      : [],
  });

  const setup = (
    current: ReturnType<typeof profile> | null,
    signed: boolean,
    inScope = true,
  ) => {
    const repository = {
      findProfessionalProfile: jest.fn().mockResolvedValue(current),
      activeSignature: jest
        .fn()
        .mockResolvedValue(signed ? { id: 'signature' } : null),
      listProfessionals: jest
        .fn()
        .mockResolvedValue(inScope && current ? [current] : []),
    };
    return new WorkforceService(
      repository as never,
      new WorkforceMapper(),
      new ProfessionalSignatoryPolicy(),
      semCota,
    );
  };

  it.each([
    [true, false, 'FIELD_TECHNICIAN', 'SERVICE_ORDER', true],
    [true, false, 'TECHNICAL_RESPONSIBLE', 'PMOC', false],
    [false, true, 'TECHNICAL_RESPONSIBLE', 'PMOC', true],
    [false, true, 'FIELD_TECHNICIAN', 'SERVICE_ORDER', false],
    [true, true, 'FIELD_TECHNICIAN', 'SERVICE_ORDER', true],
    [true, true, 'TECHNICAL_RESPONSIBLE', 'TECHNICAL_REPORT', true],
  ] as const)(
    'keeps roles independent',
    async (field, responsible, signedAs, documentType, eligible) => {
      const result = await setup(
        profile(field, responsible),
        true,
      ).professionalEligibility('org', 'user', {
        signedAs,
        documentType,
        businessUnitId: 'unit',
      });
      expect(result.eligible).toBe(eligible);
    },
  );

  it('does not grant responsibility from credential plus signature', async () => {
    const result = await setup(
      profile(false, false, true),
      true,
    ).professionalEligibility('org', 'user', {
      signedAs: 'TECHNICAL_RESPONSIBLE',
      documentType: 'PMOC',
    });
    expect(result).toMatchObject({
      eligible: false,
      blockedReason: 'PROFESSIONAL_ROLE_MISSING',
    });
  });

  it('allows a responsible professional without CREA', async () => {
    const result = await setup(
      profile(false, true, false),
      true,
    ).professionalEligibility('org', 'user', {
      signedAs: 'TECHNICAL_RESPONSIBLE',
      documentType: 'PMOC',
    });
    expect(result.eligible).toBe(true);
  });

  it('reports a machine-readable missing signature reason', async () => {
    const result = await setup(
      profile(true, false),
      false,
    ).professionalEligibility('org', 'user', {
      signedAs: 'FIELD_TECHNICIAN',
      documentType: 'SERVICE_ORDER',
    });
    expect(result.blockedReason).toBe('SIGNATURE_MISSING');
  });

  it('does not infer eligibility outside the business-unit membership', async () => {
    const result = await setup(
      profile(true, false),
      true,
      false,
    ).professionalEligibility('org', 'user', {
      signedAs: 'FIELD_TECHNICIAN',
      documentType: 'SERVICE_ORDER',
      businessUnitId: 'unit',
    });
    expect(result.blockedReason).toBe('BUSINESS_UNIT_SCOPE_MISSING');
  });
});
