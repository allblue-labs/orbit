import { Resolver } from 'node:dns/promises';
import { OutboundDns } from './outbound-dns';
describe('Outbound DNS cancellation and A/AAAA validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('queries both families and preserves all answers', async () => {
    jest
      .spyOn(Resolver.prototype, 'resolve4')
      .mockResolvedValue(['93.184.216.34'] as never);
    jest
      .spyOn(Resolver.prototype, 'resolve6')
      .mockResolvedValue(['2606:4700:4700::1111'] as never);
    const cancel = jest.spyOn(Resolver.prototype, 'cancel');
    expect(await new OutboundDns().resolve('provider.example.test')).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    expect(cancel).toHaveBeenCalled();
  });
  it('permits an absent family, but fails closed on lookup errors', async () => {
    jest
      .spyOn(Resolver.prototype, 'resolve4')
      .mockResolvedValue(['93.184.216.34'] as never);
    const v6 = jest
      .spyOn(Resolver.prototype, 'resolve6')
      .mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }));
    const dns = new OutboundDns();
    expect(await dns.resolve('provider.example.test')).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    v6.mockRejectedValue(Object.assign(new Error(), { code: 'ETIMEOUT' }));
    await expect(dns.resolve('provider.example.test')).rejects.toThrow();
  });
  it('cancels stalled DNS within the supplied deadline and recovers admission capacity', async () => {
    jest.useFakeTimers();
    let reject4: (reason: Error) => void = () => undefined;
    let reject6: (reason: Error) => void = () => undefined;
    jest.spyOn(Resolver.prototype, 'resolve4').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          reject4 = reject;
        }) as never,
    );
    jest.spyOn(Resolver.prototype, 'resolve6').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          reject6 = reject;
        }) as never,
    );
    const cancel = jest
      .spyOn(Resolver.prototype, 'cancel')
      .mockImplementation(() => {
        reject4(new Error('cancelled'));
        reject6(new Error('cancelled'));
      });
    const dns = new OutboundDns();
    const pending = expect(
      dns.resolve('provider.example.test', 100),
    ).rejects.toThrow('cancelled');
    await jest.advanceTimersByTimeAsync(101);
    await pending;
    expect(cancel).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(jest.getTimerCount()).toBe(0);
  });
});
