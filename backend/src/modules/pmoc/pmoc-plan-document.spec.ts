/**
 * O documento do plano de PMOC, no que dá para afirmar sobre bytes de PDF.
 *
 * A aparência não se testa aqui — para isso existe o olho e as amostras que o
 * desenvolvimento gera. O que se testa é o que quebra calado: a máscara do
 * CNPJ que sai errada, a periodicidade impressa em código de enum, a tabela de
 * equipamentos que estoura a página sem repetir o cabeçalho, e o JSON livre do
 * roteiro — que tem duas formas em produção e nenhuma validação no banco.
 */
import { PmocService } from './pmoc.service';
import { PmocPlanDocumentService } from '../artifact-rendering/pmoc-plan-document.service';
import { EntityNotFoundException } from '../../exceptions';
import type { PmocActor } from './pmoc.service';
import { pdfText, pdfPageCount } from '../../../test/support/pdf-text';

const ATOR: PmocActor = {
  organizationId: 'org-1',
  actorId: 'user-1',
  permissions: ['pmoc.read'],
  businessUnitIds: ['bu-1'],
  isOrganizationOwner: true,
};

function coberturas(quantidade: number) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    startsOn: '2026-01-15',
    asset: {
      name: 'Split Hi-Wall',
      manufacturer: 'Carrier',
      model: `MOD-${indice}`,
      identifier: `TAG-${indice}`,
      serialNumber: `SN-${indice}`,
      location: `Sala ${indice + 1}`,
      specifications: { capacidadeBtu: '12000' },
    },
  }));
}

function fonte(
  overrides: {
    coberturas?: number;
    procedure?: unknown;
    serviceTypes?: unknown;
    semAssinatura?: boolean;
  } = {},
) {
  return {
    plan: {
      code: 'PMOC-000023',
      name: 'Edifício Aurora — Torre A',
      status: 'ACTIVE',
      notes: 'Acesso ao shaft somente com acompanhamento da zeladoria.',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      frequencyAmount: 3,
      frequencyUnit: 'MONTHS',
      serviceTypes: overrides.serviceTypes ?? ['Limpeza', 'Higienização'],
      procedure: overrides.procedure ?? {
        Evaporadora: ['Limpar filtros', 'Verificar dreno'],
        Condensadora: [{ label: 'Medir corrente' }],
      },
      lastExecutedAt: new Date('2026-03-10T12:00:00Z'),
      nextDueOn: '2026-06-10',
      technician: { displayName: 'Rafael Nunes' },
      technicalResponsible: {
        displayName: 'Eng. Helena Braga',
        /* Como o `documentSource` agora seleciona: a ativa, uma só. */
        professionalSignatures: overrides.semAssinatura
          ? []
          : [
              {
                storageObject: {
                  bucket: 'orbit',
                  objectKey: 'signatures/helena.png',
                  mimeType: 'image/png',
                },
              },
            ],
      },
      customer: {
        legalName: 'Condomínio Edifício Aurora',
        tradeName: 'Ed. Aurora',
        documentType: 'CNPJ',
        documentNumber: '21505237000102',
      },
      businessUnit: {
        legalName: 'Clima Norte Serviços Ltda',
        tradeName: 'Clima Norte',
        documentType: 'CNPJ',
        documentNumber: '11222333000181',
        email: 'contato@climanorte.com.br',
        phone: '+55 11 4002-8922',
        website: 'climanorte.com.br',
        city: 'São Paulo',
        stateCode: 'SP',
        district: 'Pinheiros',
        street: 'Rua Girassol',
        number: '742',
        timezone: 'America/Sao_Paulo',
      },
    },
    coverages: coberturas(overrides.coberturas ?? 3),
    planUnits: [
      {
        unit: {
          name: 'Pavimento térreo',
          checklistTemplate: { name: 'Roteiro trimestral' },
        },
      },
    ],
  };
}

/**
 * Um PNG de um pixel, para a assinatura do responsável.
 *
 * Imagem real e não `Buffer.from('x')`: o compositor entrega os bytes ao PDFKit, que
 * recusa o que não é imagem — e um dublê inválido faria o teste passar pelo caminho
 * de erro em vez do caminho que interessa.
 */
const PNG_DE_UM_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

function servico(
  fonteDoPlano: unknown,
  storage: { get: jest.Mock } = {
    get: jest.fn().mockResolvedValue(PNG_DE_UM_PIXEL),
  },
  assinaturaColetada: unknown = null,
) {
  const repository = {
    documentSource: jest.fn().mockResolvedValue(fonteDoPlano),
    /* Sem assinatura do contratante por padrão: é o estado de um contrato recém
       criado, e é nele que a maioria dos testes deste arquivo trabalha. */
    latestSignature: jest.fn().mockResolvedValue(assinaturaColetada),
  };
  const service = new PmocService(
    repository as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    new PmocPlanDocumentService(),
    storage as never,
  );
  return { service, repository, storage };
}

describe('documento do plano de PMOC', () => {
  it('imprime identificação, partes e periodicidade em português', async () => {
    const { service } = servico(fonte());

    const documento = await service.document('plan-1', ATOR);
    const texto = pdfText(documento.bytes);

    expect(documento.mimeType).toBe('application/pdf');
    expect(documento.fileName).toBe('PMOC-000023-plano.pdf');
    expect(texto).toContain('PMOC-000023');
    expect(texto).toContain('Ed. Aurora');
    expect(texto).toContain('Clima Norte');
    // A máscara é do domínio: um CNPJ impresso cru vira reclamação de auditoria.
    expect(texto).toContain('21.505.237/0001-02');
    expect(texto).toContain('a cada 3 meses');
    // Datas em pt-BR, não no ISO que veio do banco.
    expect(texto).toContain('01/01/2026');
    expect(texto).not.toContain('2026-01-01');
  });

  it('imprime o roteiro nas duas formas que o JSON livre assume', async () => {
    const { service } = servico(fonte());

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    expect(texto).toContain('Limpar filtros');
    expect(texto).toContain('Medir corrente');
  });

  it('ignora roteiro e tipos de serviço malformados em vez de falhar', async () => {
    const { service } = servico(
      fonte({
        procedure: {
          Evaporadora: [42, null, { codigo: 'ZZTOP' }, 'Limpar filtros'],
          Vazio: [],
        },
        serviceTypes: 'Limpeza',
      }),
    );

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    expect(texto).toContain('Limpar filtros');
    // Objeto sem rótulo reconhecível não vira linha: o roteiro impresso não
    // pode conter chaves internas do JSON.
    expect(texto).not.toContain('ZZTOP');
    expect(texto.toUpperCase()).not.toContain('VAZIO');
  });

  it('distribui a tabela de equipamentos e repete o cabeçalho', async () => {
    const { service } = servico(fonte({ coberturas: 60 }));

    const documento = await service.document('plan-1', ATOR);
    const texto = pdfText(documento.bytes);

    expect(pdfPageCount(documento.bytes)).toBeGreaterThan(1);
    /* A legenda é do documento, não de uma célula: em minúscula, acima da
       tabela. Concatenada ao cabeçalho da primeira coluna — que foi o defeito
       — ela estourava a largura reservada para "Item". */
    expect(texto).toContain('(continuação)');
    expect(texto).not.toContain('ITEM (');
    expect(texto).toContain('MOD-59');
  });

  /* ---------------------------------------------------------------- */
  /* A assinatura do Responsável Técnico                               */
  /* ---------------------------------------------------------------- */

  /**
   * O defeito relatado: a assinatura não saía no contrato.
   *
   * O bloco de assinatura do compositor sempre desenhou imagem quando recebia uma;
   * o serviço nunca carregava os bytes, então a linha do responsável saía em branco
   * mesmo com assinatura cadastrada — e é ela que dá valor ao papel que o fiscal
   * pede na porta.
   *
   * O que se pode afirmar sobre bytes de PDF é que a imagem foi **buscada e
   * entregue**: o conteúdo visual não se testa aqui, e o PDF cresce com ela.
   */
  it('busca a assinatura ativa do Responsável Técnico', async () => {
    const { service, storage } = servico(fonte());

    await service.document('plan-1', ATOR);

    expect(storage.get).toHaveBeenCalledWith({
      bucket: 'orbit',
      objectKey: 'signatures/helena.png',
    });
  });

  it('a assinatura entra no documento', async () => {
    const { service } = servico(fonte());
    const comAssinatura = await service.document('plan-1', ATOR);

    const { service: outro } = servico(fonte({ semAssinatura: true }));
    const semAssinatura = await outro.document('plan-1', ATOR);

    /* A imagem embutida pesa: um PDF com ela é maior que o mesmo sem ela. É o que
       dá para afirmar sem interpretar o desenho. */
    expect(comAssinatura.bytes.length).toBeGreaterThan(
      semAssinatura.bytes.length,
    );
  });

  /** Sem assinatura cadastrada o contrato sai — a linha em branco é para assinar à mão. */
  it('sem assinatura cadastrada, o contrato sai igual', async () => {
    const { service, storage } = servico(fonte({ semAssinatura: true }));

    const documento = await service.document('plan-1', ATOR);

    expect(storage.get).not.toHaveBeenCalled();
    expect(pdfText(documento.bytes)).toContain('Eng. Helena Braga');
  });

  /**
   * Storage fora do ar não derruba o contrato.
   *
   * O objeto pode estar inacessível — bucket caído, chave apagada à mão. O contrato
   * do PMOC é o papel que o fiscal pede, e não pode deixar de existir por causa de
   * um arquivo de imagem: sai com a linha em branco, como quem nunca cadastrou.
   */
  it('falha ao ler a assinatura não impede a emissão', async () => {
    const { service } = servico(fonte(), {
      get: jest.fn().mockRejectedValue(new Error('bucket indisponível')),
    });

    const documento = await service.document('plan-1', ATOR);

    expect(documento.bytes.length).toBeGreaterThan(0);
    expect(pdfText(documento.bytes)).toContain('Eng. Helena Braga');
  });

  /* ---------------------------------------------------------------- */
  /* A assinatura do contratante, coletada pelo link público           */
  /* ---------------------------------------------------------------- */

  const assinaturaDoContratante = {
    signerName: 'Maria Contratante',
    signerDocument: '123.456.789-00',
    signedAt: new Date('2026-10-04T14:30:00.000Z'),
    signatureFile: {
      bucket: 'orbit',
      objectKey: 'pmoc-contract-signatures/abc.png',
      mimeType: 'image/png',
    },
  };

  /**
   * O fim da linha do recurso de assinatura pública.
   *
   * Coletar a assinatura sem ela sair no contrato deixaria o contratante assinando
   * para nada — e é no contrato que a assinatura tem valor.
   */
  it('a assinatura do contratante nomeia quem assinou', async () => {
    const { service } = servico(
      fonte(),
      { get: jest.fn().mockResolvedValue(PNG_DE_UM_PIXEL) },
      assinaturaDoContratante,
    );

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    /* O nome de quem apertou "assinar" vence o do cadastro: o documento deve nomear
       a pessoa que assinou, não a que estava na ficha. */
    expect(texto).toContain('Maria Contratante');
  });

  it('registra quando foi assinado, no fuso da unidade', async () => {
    const { service } = servico(
      fonte(),
      { get: jest.fn().mockResolvedValue(PNG_DE_UM_PIXEL) },
      assinaturaDoContratante,
    );

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    /* 14:30 UTC é 11:30 em São Paulo, que é o fuso da unidade da fixture. Imprimir em
       UTC diria ao contratante que ele assinou três horas depois. */
    expect(texto).toContain('11:30');
    expect(texto).toContain('04/10/2026');
  });

  it('busca a imagem da assinatura coletada', async () => {
    const storage = { get: jest.fn().mockResolvedValue(PNG_DE_UM_PIXEL) };
    const { service } = servico(fonte(), storage, assinaturaDoContratante);

    await service.document('plan-1', ATOR);

    expect(storage.get).toHaveBeenCalledWith({
      bucket: 'orbit',
      objectKey: 'pmoc-contract-signatures/abc.png',
    });
  });

  /**
   * Sem os bytes, o nome e a data sobrevivem.
   *
   * É informação que o documento tem e que a linha em branco perderia: "assinado por
   * Maria em 04/10" vale mesmo sem o traço desenhado.
   */
  it('falha ao ler a imagem não apaga quem assinou', async () => {
    const { service } = servico(
      fonte(),
      { get: jest.fn().mockRejectedValue(new Error('bucket fora do ar')) },
      assinaturaDoContratante,
    );

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    expect(texto).toContain('Maria Contratante');
    expect(texto).toContain('04/10/2026');
  });

  /** Contrato sem assinatura coletada sai como sempre: linha em branco para assinar. */
  it('sem assinatura coletada, o contrato nomeia o cliente', async () => {
    const { service } = servico(fonte());

    const texto = pdfText((await service.document('plan-1', ATOR)).bytes);

    expect(texto).toContain('Ed. Aurora');
    expect(texto).not.toContain('Maria Contratante');
  });

  it('recusa plano de outra organização como inexistente', async () => {
    const { service, repository } = servico(null);

    await expect(service.document('plan-1', ATOR)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    expect(repository.documentSource).toHaveBeenCalledWith('plan-1', 'org-1');
  });
});
