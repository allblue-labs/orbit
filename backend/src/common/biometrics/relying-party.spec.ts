import { relyingPartyFrom } from './relying-party';

describe('relyingPartyFrom', () => {
  it('usa as origens do CORS e o domínio da primeira', () => {
    expect(
      relyingPartyFrom({
        FRONTEND_ORIGIN: 'https://app.orbit.test, https://orbit.test',
      }),
    ).toEqual({
      id: 'app.orbit.test',
      name: 'Orbit',
      origins: ['https://app.orbit.test'],
    });
  });

  it('aceita um domínio pai explícito', () => {
    expect(
      relyingPartyFrom({
        FRONTEND_ORIGIN: 'https://app.orbit.test,https://orbit.test',
        WEBAUTHN_RP_ID: 'orbit.test',
      })?.origins,
    ).toEqual(['https://app.orbit.test', 'https://orbit.test']);
  });

  it('sem origem válida, não há biometria na web', () => {
    expect(relyingPartyFrom({})).toBeNull();
    expect(relyingPartyFrom({ FRONTEND_ORIGIN: '*' })).toBeNull();
    expect(
      relyingPartyFrom({
        FRONTEND_ORIGIN: 'https://app.orbit.test',
        WEBAUTHN_RP_ID: 'outro.test',
      }),
    ).toBeNull();
  });
});
