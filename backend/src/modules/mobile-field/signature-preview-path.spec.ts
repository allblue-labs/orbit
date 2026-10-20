/**
 * A prévia da assinatura aponta para o caminho de quem perguntou.
 *
 * ## O defeito que isto cerca
 *
 * A mesma assinatura é servida por dois controllers — o do aplicativo de campo e
 * o do perfil na Web — e a URL assinada tem de apontar para o caminho do
 * cliente que pediu. O parâmetro tinha valor padrão, e só a consulta o
 * sobrescrevia: **logo depois de cadastrar pela Web**, a resposta trazia o
 * caminho do mobile, a tela guardava esse endereço no cache e a imagem não
 * carregava. Recarregar consertava, porque aí quem respondia era o `GET` — o que
 * fazia o defeito parecer intermitente e sumir na hora de investigar.
 *
 * O padrão foi removido, então esquecer virou erro de compilação. Estes testes
 * guardam o comportamento: cada caminho pedido é o caminho devolvido.
 */
import { createHash } from 'node:crypto';

import { MobileSignatureController } from './mobile-signature.controller';
import {
  MOBILE_PREVIEW_PATH,
  MobileSignatureService,
  PROFILE_PREVIEW_PATH,
} from './mobile-signature.service';
import { ProfessionalSignatureController } from './professional-signature.controller';

const actor = {
  id: '01900000-0000-7000-8000-000000000001',
  organizationId: '01900000-0000-7000-8000-000000000002',
  businessUnitIds: ['01900000-0000-7000-8000-000000000003'],
  permissions: ['operations.read'],
};

/* PNG de verdade nos oito primeiros bytes: o serviço fareja a assinatura do
   formato e recusa conteúdo que não bate com o `mimeType` declarado. */
const bytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('assinatura'),
]);
const sha256 = createHash('sha256').update(bytes).digest('hex');

const storageObject = {
  bucket: 'orbit',
  objectKey: 'org/signatures/2026/09/a.png',
  fileName: 'assinatura.png',
  mimeType: 'image/png',
  sizeBytes: BigInt(bytes.length),
  sha256,
  status: 'AVAILABLE',
};

const storageConfig = {
  signedUrlTtlSeconds: 300,
  localSigningSecret: 'test-signature-preview-secret-at-least-32-bytes',
};

const profile = {
  active: true,
  fieldTechnicianEnabled: true,
  technicalResponsibleEnabled: false,
};

function montar() {
  const repository = {
    context: jest.fn().mockResolvedValue({
      membership: { id: 'm' },
      profile,
      signature: {
        version: 2,
        updatedAt: new Date('2026-09-26T12:00:00Z'),
        sha256,
        storageObject,
      },
    }),
    signatureUploadFile: jest.fn().mockResolvedValue({
      createdById: actor.id,
    }),
    storageFile: jest.fn().mockResolvedValue({
      ...storageObject,
      id: '01900000-0000-7000-8000-000000000009',
      createdById: actor.id,
    }),
    replace: jest.fn().mockResolvedValue({
      signature: { version: 3, updatedAt: new Date('2026-09-26T13:00:00Z') },
      replacedVersion: 2,
    }),
  };

  const files = {
    confirm: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue(bytes),
  };

  const service = new MobileSignatureService(
    repository as never,
    files as never,
    storageConfig as never,
  );

  return { service, repository };
}

/** O caminho, sem a consulta assinada. */
function caminhoDe(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

describe('caminho da prévia da assinatura', () => {
  it('a consulta do perfil devolve o caminho do perfil', async () => {
    const { service } = montar();

    const status = await service.status(actor, PROFILE_PREVIEW_PATH);

    expect(caminhoDe(status.preview?.url)).toBe(PROFILE_PREVIEW_PATH);
  });

  it('a consulta do aplicativo devolve o caminho do aplicativo', async () => {
    const { service } = montar();

    const status = await service.status(actor, MOBILE_PREVIEW_PATH);

    expect(caminhoDe(status.preview?.url)).toBe(MOBILE_PREVIEW_PATH);
  });

  it('o cadastro pelo perfil devolve o caminho do perfil', async () => {
    /* Era aqui que o defeito morava: a resposta do cadastro trazia o caminho do
       mobile, e a tela da Web guardava esse endereço. */
    const { service } = montar();

    const resultado = await service.upload(
      actor,
      { storageObjectId: '01900000-0000-7000-8000-000000000009' },
      PROFILE_PREVIEW_PATH,
    );

    expect(caminhoDe(resultado.preview?.url)).toBe(PROFILE_PREVIEW_PATH);
  });

  it('o cadastro pelo aplicativo devolve o caminho do aplicativo', async () => {
    const { service } = montar();

    const resultado = await service.upload(
      actor,
      { storageObjectId: '01900000-0000-7000-8000-000000000009' },
      MOBILE_PREVIEW_PATH,
    );

    expect(caminhoDe(resultado.preview?.url)).toBe(MOBILE_PREVIEW_PATH);
  });

  it('a prévia vem assinada e com prazo, em qualquer caminho', async () => {
    /* O endereço não vale sozinho: sem a assinatura e o prazo, seria um link
       permanente para a imagem da assinatura de alguém. */
    const { service } = montar();

    const status = await service.status(actor, PROFILE_PREVIEW_PATH);

    expect(status.preview?.url).toMatch(/[?&]expires=\d+/);
    expect(status.preview?.url).toMatch(/[?&]signature=[0-9a-f]{64}/);
    expect(status.preview?.expiresAt).toBeTruthy();
  });
});

describe('cada controller pede o seu caminho', () => {
  /**
   * O teste do serviço acima não pega um controller que peça o caminho errado —
   * e é no controller que a escolha mora. Aqui a asserção é sobre o **argumento
   * pedido**, que é a decisão de cada porta.
   */
  const request = {
    identity: {
      id: actor.id,
      organizationId: actor.organizationId,
      businessUnitIds: actor.businessUnitIds,
      permissions: actor.permissions,
      isOrganizationOwner: true,
    },
  };

  function servicoFalso() {
    return {
      status: jest.fn().mockResolvedValue({}),
      upload: jest.fn().mockResolvedValue({}),
    };
  }

  it('o perfil pede o caminho do perfil, ao consultar e ao cadastrar', async () => {
    const servico = servicoFalso();
    const controller = new ProfessionalSignatureController(servico as never);

    await controller.status(request as never);
    await controller.activate(request as never, {
      storageObjectId: '01900000-0000-7000-8000-000000000009',
    });

    expect(servico.status).toHaveBeenCalledWith(
      expect.anything(),
      PROFILE_PREVIEW_PATH,
    );
    expect(servico.upload).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      PROFILE_PREVIEW_PATH,
    );
  });

  it('o aplicativo de campo pede o caminho dele', async () => {
    const servico = servicoFalso();
    const controller = new MobileSignatureController(servico as never);

    await controller.status(request as never);
    await controller.upload(request as never, {
      storageObjectId: '01900000-0000-7000-8000-000000000009',
    });

    expect(servico.status).toHaveBeenCalledWith(
      expect.anything(),
      MOBILE_PREVIEW_PATH,
    );
    expect(servico.upload).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      MOBILE_PREVIEW_PATH,
    );
  });
});
