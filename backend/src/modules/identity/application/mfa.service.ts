import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { CRYPTO_PROVIDER, HASH_PROVIDER } from '../../../providers';
import type { ICryptoProvider, IHashProvider } from '../../../contracts';
import {
  UnauthorizedException,
  ValidationException,
} from '../../../exceptions';
import { IdentityRepository } from '../infrastructure/identity.repository';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotp,
} from '../../../utils/totp';

@Injectable()
export class MfaService {
  constructor(
    private readonly repository: IdentityRepository,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
  ) {}

  async beginEnrollment(userId: string, email: string) {
    const secret = generateTotpSecret();
    const factor = await this.repository.createMfaFactor(
      userId,
      this.crypto.encrypt(secret),
    );
    const uri = generateTotpUri('Orbit', email, secret);

    return {
      factorId: factor.id,
      secret,
      uri,
      /**
       * O QR desenhado aqui, e não no navegador.
       *
       * A tela mostrava só o segredo em base32 e pedia que a pessoa o
       * digitasse no aplicativo autenticador — trinta e dois caracteres sem
       * sentido, num celular, e um erro basta para o código nunca bater.
       * Apontar a câmera é o caminho que todo aplicativo espera.
       *
       * Gerar no servidor evita uma dependência de renderização no cliente, e
       * não expõe nada a mais: o QR **é** a mesma URI que já vai na resposta,
       * e o segredo também.
       *
       * SVG porque escala sem borrar em qualquer densidade de tela, e porque
       * um QR borrado é um QR que a câmera não lê.
       */
      qrCode: await this.qrCode(uri),
    };
  }

  private async qrCode(uri: string): Promise<string> {
    const svg = await QRCode.toString(uri, {
      type: 'svg',
      margin: 1,
      /* `M` corrige até 15% de área danificada. Acima disso o código fica
         mais denso sem ganho prático numa tela. */
      errorCorrectionLevel: 'M',
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  async enable(userId: string, factorId: string, code: string) {
    const factor = await this.repository.findMfaFactor(factorId, userId);
    if (!factor || factor.verifiedAt) {
      throw new ValidationException('Invalid MFA enrollment');
    }
    if (!verifyTotp(this.crypto.decrypt(factor.secret), code)) {
      throw new ValidationException('Invalid MFA code');
    }
    const recoveryCodes = Array.from({ length: 8 }, () =>
      this.crypto.randomBytes(8).toString('hex'),
    );
    const recoveryHashes = await Promise.all(
      recoveryCodes.map((recoveryCode) => this.hashes.hash(recoveryCode)),
    );
    await this.repository.enableMfaFactor(factor.id, recoveryHashes);
    return { recoveryCodes };
  }

  async verifyFactor(
    factor: { id: string; secret: string; recoveryCodes: string[] },
    code: string | undefined,
  ): Promise<void> {
    if (!code) {
      throw new UnauthorizedException('MFA code is required', 'MFA_REQUIRED');
    }
    if (verifyTotp(this.crypto.decrypt(factor.secret), code)) {
      await this.repository.touchMfaFactor(factor.id);
      return;
    }
    const recoveryMatches = await Promise.all(
      factor.recoveryCodes.map((hash) => this.hashes.verify(hash, code)),
    );
    const matchedIndex = recoveryMatches.findIndex(Boolean);
    if (matchedIndex < 0) {
      throw new UnauthorizedException('Invalid MFA code', 'MFA_INVALID');
    }
    await this.repository.consumeMfaRecoveryCode(
      factor.id,
      factor.recoveryCodes.filter((_, index) => index !== matchedIndex),
    );
  }

  disable(userId: string): Promise<void> {
    return this.repository.disableMfa(userId);
  }
}
