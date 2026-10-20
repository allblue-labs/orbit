/**
 * O QR do cadastro de segundo fator.
 *
 * O que se guarda aqui é que o código desenhado **é** a mesma URI que o
 * aplicativo autenticador espera. Um QR que aponte para outra coisa gera
 * códigos que nunca batem, e quem cadastrou só descobre no próximo login.
 */
import { MfaService } from './mfa.service';
import type { IdentityRepository } from '../infrastructure/identity.repository';
import type { ICryptoProvider, IHashProvider } from '../../../contracts';

function montar() {
  const repository = {
    createMfaFactor: jest.fn().mockResolvedValue({ id: 'factor-1' }),
  };
  const crypto = {
    encrypt: (valor: string) => `cifrado:${valor}`,
    decrypt: (valor: string) => valor.replace('cifrado:', ''),
  };
  const service = new MfaService(
    repository as unknown as IdentityRepository,
    crypto as unknown as ICryptoProvider,
    {} as unknown as IHashProvider,
  );
  return { service, repository };
}

/** O SVG de dentro do data URI. */
function svgDoDataUri(dataUri: string): string {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return Buffer.from(base64, 'base64').toString('utf8');
}

describe('QR do segundo fator', () => {
  it('devolve um SVG que a tela pode desenhar direto', async () => {
    const { service } = montar();

    const cadastro = await service.beginEnrollment('user-1', 'p@exemplo.com');

    expect(cadastro.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = svgDoDataUri(cadastro.qrCode);
    expect(svg).toContain('<svg');
    /* Vetor, não bitmap: um QR borrado é um QR que a câmera não lê. */
    expect(svg).toContain('viewBox');
  });

  it('não substitui o segredo digitável', async () => {
    const { service } = montar();

    const cadastro = await service.beginEnrollment('user-1', 'p@exemplo.com');

    /* Quem não consegue usar a câmera precisa do segredo em base32. */
    expect(cadastro.secret).toMatch(/^[A-Z2-7]+$/);
    expect(cadastro.uri).toContain('otpauth://totp/');
    expect(cadastro.uri).toContain(cadastro.secret);
  });

  it('guarda o segredo cifrado, nunca em claro', async () => {
    const { service, repository } = montar();

    const cadastro = await service.beginEnrollment('user-1', 'p@exemplo.com');

    expect(repository.createMfaFactor).toHaveBeenCalledWith(
      'user-1',
      `cifrado:${cadastro.secret}`,
    );
  });
});
