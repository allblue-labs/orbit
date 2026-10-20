import { ProfessionalSignatoryPolicy } from './professional-signatory.policy';

describe('ProfessionalSignatoryPolicy', () => {
  const policy = new ProfessionalSignatoryPolicy();

  it('keeps field and technical responsibility independent per document', () => {
    expect(policy.allows('SERVICE_ORDER', 'FIELD_TECHNICIAN')).toBe(true);
    expect(policy.allows('SERVICE_ORDER', 'TECHNICAL_RESPONSIBLE')).toBe(false);
    expect(policy.allows('PMOC', 'FIELD_TECHNICIAN')).toBe(false);
    expect(policy.allows('PMOC', 'TECHNICAL_RESPONSIBLE')).toBe(true);
    expect(policy.allows('TECHNICAL_REPORT', 'TECHNICAL_RESPONSIBLE')).toBe(
      true,
    );
    expect(policy.allows('RECEIPT', 'FIELD_TECHNICIAN')).toBe(false);
  });
});
