import { TrialEligibilityService } from './trial-eligibility.service';

describe('teste posterior ao cadastro', () => {
  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false],
  ])(
    'histórico elegível %s, documento já testou %s -> elegível %s',
    async (eligible, consumed, expected) => {
      const repository = {
        trialCandidate: jest
          .fn()
          .mockResolvedValue({ document: 'document-fixture', eligible }),
        fingerprintConsumed: jest.fn().mockResolvedValue(consumed),
      };
      const service = new TrialEligibilityService(
        repository as never,
        { fingerprint: () => 'fingerprint-fixture' } as never,
      );
      await expect(service.canStartPendingTrial('org')).resolves.toBe(expected);
    },
  );
  it('não usa documento enviado pelo navegador e concede exatamente 30 dias', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
    try {
      const repository = {
        trialCandidate: jest.fn().mockResolvedValue({
          document: 'canonical-document',
          eligible: true,
        }),
        startPendingTrial: jest.fn().mockResolvedValue({}),
      };
      const fingerprint = jest.fn().mockReturnValue('fingerprint');
      const service = new TrialEligibilityService(
        repository as never,
        { fingerprint } as never,
      );
      await service.startPendingTrial('org', 7, 'ANNUAL');
      expect(fingerprint).toHaveBeenCalledWith('canonical-document');
      expect(repository.startPendingTrial).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 7,
          billingInterval: 'ANNUAL',
          startsAt: new Date('2026-10-23T15:00:00Z'),
          endsAt: new Date('2026-11-22T15:00:00Z'),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
  it('recusa cliente que já pagou ou já teve avaliação sem conceder novos dias', async () => {
    const repository = {
      trialCandidate: jest
        .fn()
        .mockResolvedValue({ document: 'canonical-document', eligible: false }),
      startPendingTrial: jest.fn(),
    };
    const service = new TrialEligibilityService(
      repository as never,
      {} as never,
    );
    await expect(
      service.startPendingTrial('org', 7, 'MONTHLY'),
    ).rejects.toMatchObject({ code: 'TRIAL_NOT_ELIGIBLE' });
    expect(repository.startPendingTrial).not.toHaveBeenCalled();
  });
});
