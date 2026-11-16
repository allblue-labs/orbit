import { simulatorRecipient } from './simulate-ses-feedback';

describe('Mailbox Simulator operator command, no network', () => {
  it.each(['success', 'bounce', 'complaint'])(
    'restricts %s to a unique AWS simulator address',
    (scenario) => {
      const first = simulatorRecipient(scenario),
        second = simulatorRecipient(scenario);
      expect(first).toMatch(
        new RegExp(
          `^${scenario}\\+orbit-pr08-[a-f0-9-]+@simulator\\.amazonses\\.com$`,
        ),
      );
      expect(first).not.toBe(second);
    },
  );
  it.each([
    'user@example.test',
    'https://example.test',
    'success@evil.test',
    'all',
    '',
  ])('rejects arbitrary destination/scenario %s', (value) =>
    expect(() => simulatorRecipient(value)).toThrow(),
  );
});
