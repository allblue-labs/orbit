/**
 * Um autenticador de plataforma em software, para provar o WebAuthn de ponta a
 * ponta sem navegador: cria uma chave P-256, responde ao cadastro com
 * atestação `none` e assina os desafios de entrada como um Touch ID faria
 * (flags UP+UV). Só para testes.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const out = Buffer.alloc(3);
  out[0] = (major << 5) | 25;
  out.writeUInt16BE(length, 1);
  return out;
}

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number')
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array)
    return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value))
    return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const parts: Buffer[] = [head(5, value.size)];
  value.forEach((item, key) => parts.push(cbor(key), cbor(item)));
  return Buffer.concat(parts);
}

const sha256 = (data: Buffer | string) =>
  createHash('sha256').update(data).digest();

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly jwk: { x: string; y: string };
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.jwk = pair.publicKey.export({ format: 'jwk' }) as {
      x: string;
      y: string;
    };
  }

  get id(): string {
    return this.credentialId.toString('base64url');
  }

  /** A resposta de `navigator.credentials.create()`. */
  register(challenge: string) {
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(this.jwk.x, 'base64url')],
        [-3, Buffer.from(this.jwk.y, 'base64url')],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // UP | UV | AT
      Buffer.alloc(4),
      Buffer.alloc(16), // aaguid
      idLength,
      this.credentialId,
      coseKey,
    ]);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
    };
  }

  /** A resposta de `navigator.credentials.get()`. */
  authenticate(challenge: string, origin = this.origin) {
    this.counter += 1;
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin }),
    );
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x05]), // UP | UV
      count,
    ]);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientData)]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: null,
      },
    };
  }
}
