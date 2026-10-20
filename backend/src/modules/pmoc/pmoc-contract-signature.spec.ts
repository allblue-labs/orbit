import { PmocService } from './pmoc.service';
import type { PmocActor } from './pmoc.service';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import { HashHelper } from '../../helpers';

const ATOR: PmocActor = {
  organizationId: 'org-1',
  actorId: 'user-1',
  permissions: ['pmoc.manage'],
  businessUnitIds: ['bu-1'],
  isOrganizationOwner: true,
};

/**
 * O link temporário de assinatura, e a coleta.
 *
 * O que se prova aqui é o que o SQL não decide: o segredo nunca ser guardado em
 * claro, o arquivo subir antes de ser registrado, e a recusa de um link vencido não
 * virar exceção — porque "já assinado" é o fim feliz, não uma falha.
 */
describe('assinatura pública do contrato de PMOC', () => {
  const linhaDoContrato = (patch: Record<string, unknown> = {}) => ({
    state: 'VALIDO',
    plan_code: 'PMOC-0001',
    plan_name: 'Edifício Aurora',
    starts_on: new Date('2026-01-01T00:00:00.000Z'),
    ends_on: new Date('2026-12-31T00:00:00.000Z'),
    frequency_amount: 3,
    frequency_unit: 'MONTHS',
    customer_name: 'Ed. Aurora',
    emitter_name: 'Clima Norte',
    covered_equipment: 7,
    technical_responsible: 'Eng. Helena Braga',
    signer_name: null,
    signed_at: null,
    expires_at: new Date('2026-10-07T12:00:00.000Z'),
    ...patch,
  });

  const montar = (
    options: {
      plano?: Record<string, unknown> | null;
      contrato?: Record<string, unknown> | null;
      assinatura?: { state: string; signed: boolean };
    } = {},
  ) => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValue(
          options.plano === undefined
            ? { id: 'plan-1', code: 'PMOC-0001', _count: { coverages: 7 } }
            : options.plano,
        ),
      createSignatureLink: jest.fn().mockResolvedValue({
        id: 'link-1',
        expiresAt: new Date('2026-10-07T12:00:00.000Z'),
        createdAt: new Date('2026-10-04T12:00:00.000Z'),
      }),
      signatureLinkByToken: jest
        .fn()
        .mockResolvedValue(
          options.contrato === undefined ? linhaDoContrato() : options.contrato,
        ),
      signByToken: jest
        .fn()
        .mockResolvedValue(
          options.assinatura ?? { state: 'VALIDO', signed: true },
        ),
    };
    const storage = {
      defaultBucket: 'orbit',
      put: jest.fn().mockResolvedValue({ sizeBytes: 10 }),
      get: jest.fn(),
    };
    const service = new PmocService(
      repository as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      storage as never,
    );
    return { service, repository, storage };
  };

  describe('gerar o link', () => {
    /**
     * O segredo existe uma vez.
     *
     * O banco recebe o SHA-256; o token em claro volta na resposta e nunca mais.
     * Guardá-lo em claro faria um vazamento do banco virar assinatura em nome de
     * qualquer contratante.
     */
    it('guarda o hash e devolve o token em claro', async () => {
      const { service, repository } = montar();

      const resultado = await service.createSignatureLink('plan-1', ATOR);

      const [[gravado]] = repository.createSignatureLink.mock.calls as [
        [{ tokenHash: string }],
      ];
      expect(resultado.token.length).toBeGreaterThan(40);
      expect(gravado.tokenHash).toBe(HashHelper.sha256(resultado.token));
      expect(gravado.tokenHash).not.toBe(resultado.token);
    });

    it('devolve até quando o link vale', async () => {
      const { service } = montar();
      const resultado = await service.createSignatureLink('plan-1', ATOR);
      expect(resultado.expiresAt).toBe('2026-10-07T12:00:00.000Z');
    });

    /**
     * Plano sem equipamento não vira contrato para assinar.
     *
     * Não há o que o contratante leia: a cobertura é o conteúdo do contrato, e
     * pedir assinatura num plano vazio é pedir aceite de nada.
     */
    it('recusa plano sem equipamento coberto', async () => {
      const { service, repository } = montar({
        plano: { id: 'plan-1', code: 'PMOC-0001', _count: { coverages: 0 } },
      });

      await expect(
        service.createSignatureLink('plan-1', ATOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.createSignatureLink).not.toHaveBeenCalled();
    });
  });

  describe('ler o contrato pelo token', () => {
    it('devolve o resumo que a página mostra', async () => {
      const { service, repository } = montar();

      const contrato = await service.publicContract('token-em-claro');

      /* A busca é pelo hash: o token em claro nunca chega ao banco. */
      expect(repository.signatureLinkByToken).toHaveBeenCalledWith(
        HashHelper.sha256('token-em-claro'),
      );
      expect(contrato.state).toBe('VALIDO');
      expect(contrato.plan.code).toBe('PMOC-0001');
      expect(contrato.plan.frequency).toContain('3');
      expect(contrato.customer.name).toBe('Ed. Aurora');
      expect(contrato.reason).toBeNull();
    });

    /** Token que não existe é 404: não há contrato nenhum ali para explicar. */
    it('token inexistente é inexistente', async () => {
      const { service } = montar({ contrato: null });
      await expect(service.publicContract('qualquer')).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    /**
     * Link recusado **existe**, e a página diz por quê.
     *
     * É a diferença que faz o contratante não precisar ligar para o dono: expirou,
     * foi substituído ou já foi assinado são três situações, e cada uma tem o seu
     * próximo passo.
     */
    it('link recusado explica o motivo', async () => {
      const { service } = montar({
        contrato: linhaDoContrato({ state: 'EXPIRADO' }),
      });

      const contrato = await service.publicContract('token');

      expect(contrato.state).toBe('EXPIRADO');
      expect(contrato.reason).toMatch(/novo/i);
    });

    it('contrato já assinado traz quem assinou', async () => {
      const { service } = montar({
        contrato: linhaDoContrato({
          state: 'JA_ASSINADO',
          signer_name: 'Maria Contratante',
          signed_at: new Date('2026-10-05T10:00:00.000Z'),
        }),
      });

      const contrato = await service.publicContract('token');

      expect(contrato.signature).toEqual({
        signerName: 'Maria Contratante',
        signedAt: '2026-10-05T10:00:00.000Z',
      });
    });
  });

  describe('coletar a assinatura', () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
      'base64',
    );

    const assinar = (service: PmocService) =>
      service.signPublicContract('token', {
        signerName: 'Maria Contratante',
        signature: PNG,
        mimeType: 'image/png',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      });

    /**
     * O arquivo sobe antes de ser registrado.
     *
     * Registrar antes de subir deixaria o contrato apontando para um objeto que não
     * existe — e a falha aparece meses depois, quando o fiscal pede o papel.
     */
    it('sobe a imagem antes de gravar', async () => {
      const { service, repository, storage } = montar();

      await assinar(service);

      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(repository.signByToken).toHaveBeenCalledTimes(1);
      expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(
        repository.signByToken.mock.invocationCallOrder[0]!,
      );
    });

    it('registra o hash do conteúdo e o tamanho', async () => {
      const { service, repository } = montar();

      await assinar(service);

      const [[gravado]] = repository.signByToken.mock.calls as [
        [{ sha256: string; sizeBytes: number }],
      ];
      expect(gravado.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(gravado.sizeBytes).toBe(PNG.byteLength);
    });

    /** A chave do objeto não revela qual contrato é: o bucket é da organização toda. */
    it('a chave do objeto deriva do token, não do plano', async () => {
      const { service, storage } = montar();

      await assinar(service);

      const [[enviado]] = storage.put.mock.calls as [[{ objectKey: string }]];
      expect(enviado.objectKey).toContain(HashHelper.sha256('token'));
      expect(enviado.objectKey).not.toContain('plan-1');
    });

    /**
     * Link vencido não sobe arquivo.
     *
     * Subir para depois descobrir que o link não vale deixaria lixo no bucket a cada
     * tentativa num link expirado.
     */
    it('link recusado não sobe nada', async () => {
      const { service, storage, repository } = montar({
        contrato: linhaDoContrato({ state: 'EXPIRADO' }),
      });

      const resultado = await service.signPublicContract('token', {
        signerName: 'Maria',
        signature: PNG,
        mimeType: 'image/png',
      });

      expect(resultado.state).toBe('EXPIRADO');
      expect(storage.put).not.toHaveBeenCalled();
      expect(repository.signByToken).not.toHaveBeenCalled();
    });

    /** Já assinado é o fim feliz: devolve o estado, não lança. */
    it('já assinado não é erro', async () => {
      const { service } = montar({
        contrato: linhaDoContrato({ state: 'JA_ASSINADO' }),
      });

      await expect(
        service.signPublicContract('token', {
          signerName: 'Maria',
          signature: PNG,
          mimeType: 'image/png',
        }),
      ).resolves.toMatchObject({ state: 'JA_ASSINADO' });
    });

    /**
     * A corrida perdida pelo segundo.
     *
     * Dois aceites simultâneos passam pela leitura inicial; é a função no banco que
     * decide, e a resposta dela é a que vale.
     */
    it('a recusa do banco vence a leitura otimista', async () => {
      const { service } = montar({
        assinatura: { state: 'JA_ASSINADO', signed: false },
      });

      const resultado = await assinar(service);

      expect(resultado.state).toBe('JA_ASSINADO');
      expect(resultado.reason).toMatch(/já foi assinado/i);
    });

    it('assinatura aceita não tem motivo a explicar', async () => {
      const { service } = montar();
      await expect(assinar(service)).resolves.toEqual({
        state: 'VALIDO',
        reason: null,
      });
    });

    /**
     * O contrato que desaparece no meio do aceite.
     *
     * A função devolve `INEXISTENTE` quando a linha sumiu entre a leitura e o `FOR
     * UPDATE`, ou quando o plano foi removido nesse intervalo. Não é um estado de
     * link e não tem frase em `MOTIVO_DO_ESTADO`.
     *
     * Precisa ser erro, e não recusa, por uma razão que atravessa a camada: a página
     * reconhece o sucesso por `reason: null`, e um `INEXISTENTE` caindo em
     * `MOTIVO_DO_ESTADO[estado] ?? null` produzia exatamente esse formato. O
     * contratante veria "contrato assinado" sem nada gravado — e com os bytes da
     * assinatura já no bucket, sem referência nenhuma.
     */
    it('contrato que desapareceu no meio do aceite é erro, não recusa', async () => {
      const { service } = montar({
        assinatura: { state: 'INEXISTENTE', signed: false },
      });

      await expect(assinar(service)).rejects.toThrow();
    });
  });
});
