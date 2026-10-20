/**
 * Os dados de exemplo de cada modelo premium.
 *
 * ## Para que serve
 *
 * Quem administra a operação precisa ver como o documento sai **antes** de haver
 * um atendimento emitido. A tela de Modelos abre o modelo e mostra o documento
 * pronto, com o timbre e a logo da própria organização e um conteúdo fictício
 * que exercita o que o desenho tem de difícil: tabela que vira a página,
 * checklist com item reprovado, campo sem resposta, valor por extenso.
 *
 * ## Por que os dados são fictícios, e explicitamente
 *
 * A alternativa seria abrir um documento real de um cliente real para demonstrar
 * um modelo — expor dado de terceiro para responder "como isso fica". Os nomes
 * aqui são inventados, e o documento sai marcado como exemplo pelo código
 * (`AMOSTRA`), para que uma impressão dele nunca passe por emissão.
 *
 * ## Uma fonte para amostra e para preview
 *
 * `scripts/gerar-amostras.ts` consome este mesmo módulo. Enquanto os dados de
 * exemplo viviam dentro do script, conferir o desenho e mostrar o modelo ao
 * usuário eram dois conjuntos de dados diferentes — e o segundo nunca seria
 * revisado com o mesmo cuidado.
 */
import type { QuoteDocumentInput } from './renderers/pdf/documents/quote.document';
import type { DocumentEmitter } from './renderers/pdf/kit/document-context';
import type { RenderInput } from './renderers/artifact-renderer';

/** Os tipos que têm amostra. Um tipo fora desta lista não tem preview. */
export const SAMPLE_ARTIFACT_TYPES = [
  'ORDEM_SERVICO',
  'RELATORIO_VISITA',
  'RELATORIO_TECNICO',
  'QUALIDADE_AR',
  'RECIBO',
  'PMOC',
  'ORCAMENTO',
] as const;
export type SampleArtifactType = (typeof SAMPLE_ARTIFACT_TYPES)[number];

export function isSampleArtifactType(
  value: string,
): value is SampleArtifactType {
  return (SAMPLE_ARTIFACT_TYPES as readonly string[]).includes(value);
}

/** O cliente fictício. Nenhum dado aqui pertence a alguém. */
const CUSTOMER = {
  name: 'Edifício Aurora',
  legalName: 'Condomínio do Edifício Aurora',
  document: 'CNPJ 12.334.332/0001-23',
  contactPhone: '(81) 98877-7443',
  address: 'Av. Três, 10 — Maranguape — Paulista/PE',
} as const;

/**
 * Cinco equipamentos, porque a tabela precisa ter mais de uma linha para se ver
 * o zebrado, a coluna que trunca e o cabeçalho que se repete na página seguinte.
 */
const EQUIPMENT = Array.from({ length: 5 }, (_, i) => ({
  sector: ['Recepção', 'Sala técnica', 'Quarto 1', 'Suíte', 'Copa'][i],
  name: ['Split Hi-Wall', 'Cassete 4 vias'][i % 2],
  manufacturer: ['LG', 'Carrier', 'Daikin', 'Midea', 'Gree'][i],
  model: `MOD-${1200 + i}`,
  identifier: `TAG-${String(i + 1).padStart(3, '0')}`,
  capacity: `${[9, 12, 18, 24, 36][i]}.000 BTU/h`,
}));

type Field = RenderInput['sections'][number]['fields'][number];

function field(
  id: string,
  label: string,
  type: string,
  order: number,
  value: unknown,
  extra: Record<string, unknown> = {},
): Field {
  return {
    id,
    label,
    type,
    order,
    required: false,
    hidden: false,
    value,
    ...extra,
  };
}

/**
 * Um checklist com um item reprovado (com nota) e um sem resposta.
 *
 * É o caso que separa um desenho que funciona de um que só parece funcionar:
 * três estados diferentes na mesma lista, e a nota da reprovação ocupando duas
 * linhas.
 */
function checklist(labels: readonly string[]): Field[] {
  return labels.map((label, i) =>
    field(
      `c${i}`,
      label,
      'BOOLEAN',
      i + 1,
      i === 4 ? false : i === 5 ? undefined : true,
      i === 4
        ? { notes: 'Vazamento localizado e corrigido; reteste agendado.' }
        : {},
    ),
  );
}

/** Título e código de cada amostra. O código diz que é amostra. */
const IDENTIFICATION: Readonly<
  Record<SampleArtifactType, { code: string; title: string }>
> = {
  ORDEM_SERVICO: {
    code: 'AMOSTRA-OS',
    title: 'Ar-condicionado sem gelar',
  },
  RELATORIO_VISITA: {
    code: 'AMOSTRA-RVT',
    title: 'Contrato Synapse — visita de setembro',
  },
  RELATORIO_TECNICO: {
    code: 'AMOSTRA-LT',
    title: 'Avaliação de falha no chiller da central',
  },
  QUALIDADE_AR: {
    code: 'AMOSTRA-QAR',
    title: 'Análise da qualidade do ar',
  },
  RECIBO: { code: 'AMOSTRA-REC', title: 'Recibo de pagamento' },
  PMOC: { code: 'AMOSTRA-PMOC', title: 'Edifício Aurora — Torre A' },
  ORCAMENTO: { code: 'AMOSTRA-ORC', title: 'Manutenção — Edifício Aurora' },
};

function sections(artifactType: SampleArtifactType): RenderInput['sections'] {
  switch (artifactType) {
    case 'ORDEM_SERVICO':
      return [
        {
          id: 'servico',
          title: 'Serviço',
          order: 1,
          type: 'FORM',
          fields: [
            field(
              'tipo_servico',
              'Tipo de serviço',
              'SELECT',
              1,
              'Manutenção corretiva',
            ),
            field(
              'descricao',
              'Descrição',
              'LONG_TEXT',
              2,
              'Cliente relata que a unidade do quarto principal liga mas não refrigera, e pinga água pela lateral direita.',
            ),
          ],
        },
        {
          id: 'execucao',
          title: 'Execução',
          order: 2,
          type: 'FORM',
          fields: [
            field(
              'procedimentos',
              'Procedimentos realizados',
              'LONG_TEXT',
              1,
              'Dreno obstruído por biofilme; executada desobstrução e higienização da bandeja. Carga de gás a 95 psi contra 110 nominais — vazamento na porca flange, reapertada, vácuo e recarga com R-410A.',
            ),
            field(
              'materiais',
              'Materiais aplicados',
              'LONG_TEXT',
              2,
              '400 g de R-410A · 1 jogo de porcas flange 1/4" · 2 m de fita anticorrosiva',
            ),
            field(
              'pendencias',
              'Pendências',
              'LONG_TEXT',
              3,
              'Isolamento da linha da suíte ressecado em 3 m; orçamento enviado em separado. Retorno em 30 dias para reavaliar a carga.',
            ),
          ],
        },
        {
          id: 'checklist',
          title: 'Checklist da execução',
          order: 3,
          type: 'CHECKLIST',
          fields: checklist([
            'Verificar pressão de sucção e descarga',
            'Medir corrente do compressor',
            'Conferir isolamento das linhas',
            'Testar acionamento pelo controle',
            'Verificar estanqueidade',
            'Limpar filtros e bandeja',
          ]),
        },
      ];

    case 'RELATORIO_VISITA':
      return [
        {
          id: 'visita',
          title: 'Visita',
          order: 1,
          type: 'FORM',
          fields: [
            field(
              'motivo',
              'Motivo da visita',
              'LONG_TEXT',
              1,
              'Chamado aberto pela zeladoria relatando ruído intermitente e queda de rendimento nas unidades da recepção.',
            ),
            field(
              'acompanhante',
              'Acompanhado por',
              'TEXT',
              2,
              'Eduardo Silva (zeladoria)',
            ),
            field(
              'constatacoes',
              'Constatações',
              'LONG_TEXT',
              3,
              'O ruído da TAG-001 vem da folga no eixo do ventilador da evaporadora, já com marca de desgaste no mancal. A corrente medida ficou em 5,8 A contra 5,1 A nominais.',
            ),
          ],
        },
        {
          id: 'rotina',
          title: 'Rotina semanal',
          order: 2,
          type: 'CHECKLIST',
          fields: checklist([
            'Limpeza de filtro de ar',
            'Limpeza dos painéis de comando',
            'Desobstrução do dreno',
            'Verificar ruídos mecânicos',
            'Verificar fiações elétricas',
            'Verificar folga dos eixos',
          ]),
        },
        {
          id: 'encaminhamentos',
          title: 'Encaminhamentos',
          order: 3,
          type: 'FORM',
          fields: [
            field(
              'recomendacoes',
              'Recomendações',
              'LONG_TEXT',
              1,
              'Substituir o mancal do ventilador da TAG-001 nos próximos 15 dias — operar com a folga atual tende a danificar o eixo.',
            ),
            field(
              'proxima_visita',
              'Próxima visita sugerida',
              'DATE',
              2,
              '2026-10-01',
            ),
          ],
        },
      ];

    case 'RECIBO':
      return [
        {
          id: 'partes',
          title: 'Partes',
          order: 1,
          type: 'FORM',
          fields: [
            field('pagador', 'Recebemos de', 'TEXT', 1, CUSTOMER.legalName),
            field(
              'documento_pagador',
              'CNPJ ou CPF',
              'TEXT',
              2,
              CUSTOMER.document,
            ),
            field('data', 'Data', 'DATE', 3, '2026-09-16'),
          ],
        },
        {
          id: 'valor',
          title: 'Valor',
          order: 2,
          type: 'FORM',
          fields: [
            field('valor', 'Valor recebido', 'DECIMAL', 1, '1234.56', {
              unit: 'BRL',
            }),
            field(
              'referente',
              'Referente a',
              'LONG_TEXT',
              2,
              'Manutenção corretiva em três unidades split, com recarga de gás R-410A, conforme a ordem de serviço.',
            ),
            field('forma_pagamento', 'Forma de pagamento', 'SELECT', 3, 'PIX'),
            field('garantia_dias', 'Garantia (dias)', 'NUMBER', 4, 90),
          ],
        },
      ];

    case 'RELATORIO_TECNICO':
      return [
        {
          id: 'objeto',
          title: 'Objeto e metodologia',
          order: 1,
          type: 'FORM',
          fields: [
            field(
              'objeto',
              'Objeto do relatório',
              'LONG_TEXT',
              1,
              'Avaliação técnica das paradas recorrentes do chiller de 120 TR instalado na casa de máquinas do subsolo. O escopo limita-se ao circuito frigorígeno e ao sistema de condensação.',
            ),
            field(
              'metodologia',
              'Metodologia aplicada',
              'LONG_TEXT',
              2,
              'Inspeção visual, leitura do histórico de alarmes, medição de pressões com manifold digital calibrado em 03/2026 e ensaio de vazão no circuito de condensação.',
            ),
            field(
              'normas',
              'Normas de referência',
              'LONG_TEXT',
              3,
              'ABNT NBR 16401-1:2008 — Instalações de ar-condicionado. ABNT NBR 15960:2011 — Refrigeração.',
            ),
          ],
        },
        {
          id: 'analise',
          title: 'Análise',
          order: 2,
          type: 'FORM',
          fields: [
            field(
              'constatacoes',
              'Constatações',
              'LONG_TEXT',
              1,
              'A torre de resfriamento apresenta incrustação severa no enchimento, com redução estimada de 40% da área de troca. A temperatura da água de condensação foi medida em 34,8 °C contra os 29,5 °C de projeto.',
            ),
            field(
              'conclusao',
              'Conclusão',
              'LONG_TEXT',
              2,
              'Os desarmes decorrem da perda de capacidade de rejeição de calor da torre, e não de defeito do chiller. O equipamento está operando dentro de suas especificações; a restrição está no sistema de condensação.',
            ),
            field(
              'ressalvas',
              'Ressalvas',
              'LONG_TEXT',
              3,
              'Não foi possível ensaiar a bomba de condensação sob carga plena por indisponibilidade de parada programada.',
            ),
          ],
        },
      ];

    case 'QUALIDADE_AR':
      return [
        {
          id: 'ambiente',
          title: 'Ambiente',
          order: 1,
          type: 'FORM',
          fields: [
            field(
              'local',
              'Local',
              'TEXT',
              1,
              'Pavimento 3 — escritório central',
            ),
            field('area', 'Área', 'DECIMAL', 2, 412.5, { unit: 'm²' }),
            field('ocupacao', 'Ocupação média', 'NUMBER', 3, 48, {
              unit: 'pessoas',
            }),
            field(
              'equipamento_medicao',
              'Equipamento de medição',
              'TEXT',
              4,
              'Instrutherm THDL-400 (cal. 02/2026)',
            ),
          ],
        },
        {
          id: 'parametros',
          title: 'Parâmetros',
          order: 2,
          type: 'FORM',
          fields: [
            field('temperatura', 'Temperatura', 'DECIMAL', 1, 24.2, {
              unit: '°C',
            }),
            field('umidade', 'Umidade relativa', 'DECIMAL', 2, 71, {
              unit: '%',
            }),
            field('co2', 'Dióxido de carbono', 'DECIMAL', 3, 1340, {
              unit: 'ppm',
            }),
            field('velocidade_ar', 'Velocidade do ar', 'DECIMAL', 4, 0.12, {
              unit: 'm/s',
            }),
            field('particulas', 'Material particulado', 'DECIMAL', 5, 62, {
              unit: 'µg/m³',
            }),
            /* Sem valor de propósito: o documento tem de dizer "não medido" em
               vez de deixar a linha em branco. */
            field('fungos', 'Contagem de fungos', 'DECIMAL', 6, undefined, {
              unit: 'UFC/m³',
            }),
          ],
        },
        {
          id: 'parecer',
          title: 'Parecer',
          order: 3,
          type: 'FORM',
          fields: [
            field(
              'parecer',
              'Parecer técnico',
              'LONG_TEXT',
              1,
              'O ambiente apresenta renovação de ar insuficiente para a ocupação observada. A concentração de CO₂ acima do referencial é compatível com a taxa de renovação medida no insuflamento.',
            ),
            field(
              'recomendacoes',
              'Recomendações',
              'LONG_TEXT',
              2,
              'Revisar o ajuste do damper de ar externo e repetir a medição 15 dias após a correção.',
            ),
          ],
        },
      ];

    case 'PMOC':
      return [
        {
          id: 'roteiro',
          title: 'Roteiro da visita',
          order: 1,
          type: 'CHECKLIST',
          fields: checklist([
            'Limpar filtros de ar',
            'Higienizar bandeja e dreno',
            'Medir temperatura de insuflamento',
            'Limpar serpentina do condensador',
            'Medir corrente de operação',
            'Verificar pressões',
          ]),
        },
      ];

    /* Orçamento não passa pelo renderer de execução — ver `sampleQuote`. */
    case 'ORCAMENTO':
      return [];
  }
}

export interface SampleOptions {
  /** O timbre da organização que está olhando: logo e dados reais. */
  readonly emitter?: DocumentEmitter;
  readonly generatedAt?: Date;
}

/**
 * A entrada de renderização de uma amostra.
 *
 * O emitente é o **real** — é a pergunta que a tela responde: "como o meu
 * documento vai sair". Só o que seria dado de terceiro é inventado: cliente,
 * atendimento, equipamentos e respostas.
 */
export function sampleRenderInput(
  artifactType: SampleArtifactType,
  options: SampleOptions = {},
): RenderInput {
  const generatedAt = options.generatedAt ?? new Date();
  const identification = IDENTIFICATION[artifactType];

  return {
    execution: {
      id: 'amostra',
      code: identification.code,
      title: identification.title,
      status: 'COMPLETED',
      completedAt: generatedAt.toISOString(),
    },
    snapshot: {
      id: 'amostra',
      templateKey: `ORBIT_${artifactType}`,
      templateName: identification.title,
      templateVersion: 1,
      artifactType,
      structureHash: 'amostra',
    },
    sections: sections(artifactType),
    signatures: [
      {
        slotId: 'cliente',
        label: 'Cliente',
        signerRole: 'CUSTOMER',
        required: true,
        order: 1,
        signerName: 'Marcos Antunes',
        signedAt: generatedAt.toISOString(),
      },
      {
        slotId: 'responsavel',
        label: 'Responsável técnico',
        signerRole: 'TECHNICAL_MANAGER',
        required: true,
        order: 2,
        signerName: 'Helena Braga',
        professionalCredential: 'Eng.ª Mecânica · CREA-PE 1234543434',
        signedAt: generatedAt.toISOString(),
      },
    ],
    branding: {},
    layout: {},
    metadata: {
      executionNotes:
        'Ambiente entregue limpo e equipamento em operação normal na saída.',
      documentContext: {
        emitter: options.emitter,
        customer: CUSTOMER,
        operation: {
          code: 'AMOSTRA-OP',
          kind: 'CORRECTIVE',
          priority: 'HIGH',
          duration: '3 h 15 min',
          openedAt: '24/09/2026, 19:20',
          startedAt: '25/09/2026, 09:10',
          completedAt: '25/09/2026, 12:25',
          fieldTechnician: 'Eduardo Silva',
          startedBy: 'Eduardo Silva',
          completedBy: 'Eduardo Silva',
          auxiliaryTechnicians: ['Rafael Nunes'],
        },
        equipment: EQUIPMENT,
      },
    },
    correlationId: 'amostra',
    generatedAt,
  };
}

/** O orçamento de exemplo, com desconto para exercitar a linha de totais. */
export function sampleQuote(): QuoteDocumentInput {
  return {
    quote: {
      code: IDENTIFICATION.ORCAMENTO.code,
      title: 'Manutenção preventiva e corretiva — Edifício Aurora, Torre A',
      status: 'SENT',
      issuedAt: '25/09/2026',
      validUntil: '25/10/2026',
      validityDays: 30,
      notes:
        'Proposta para manutenção do parque de climatização da torre A, contemplando as quatro unidades da recepção e do primeiro pavimento.',
      author: 'Helena Braga',
      operationCode: 'AMOSTRA-OP',
    },
    customer: {
      name: CUSTOMER.name,
      legalName: CUSTOMER.legalName,
      document: CUSTOMER.document,
      email: 'sindico@edificioaurora.com.br',
      phone: CUSTOMER.contactPhone,
      address: CUSTOMER.address,
    },
    items: [
      {
        kind: 'SERVICE',
        description: 'Limpeza completa de unidade split hi-wall',
        unit: 'SERV',
        quantity: 4,
        unitPrice: 250,
        total: 1000,
      },
      {
        kind: 'SERVICE',
        description: 'Higienização química de serpentina',
        unit: 'SERV',
        quantity: 4,
        unitPrice: 180,
        total: 720,
      },
      {
        kind: 'SERVICE',
        description: 'Recarga de gás R-410A',
        unit: 'SERV',
        quantity: 2,
        unitPrice: 320,
        total: 640,
      },
      {
        kind: 'PRODUCT',
        description: 'Borracha isoladora tubular 1/2"',
        sku: 'ISO-012',
        unit: 'M',
        quantity: 3.5,
        unitPrice: 18.4,
        total: 64.4,
      },
      {
        kind: 'PRODUCT',
        description: 'Jogo de porcas flange 1/4"',
        sku: 'PF-014',
        unit: 'JG',
        quantity: 4,
        unitPrice: 27.5,
        total: 110,
      },
    ],
    totals: { subtotal: 2952.7, discount: 152.7, total: 2800 },
  };
}

/** O plano de PMOC de exemplo, para a amostra do documento de plano. */
export function samplePmocPlan() {
  return {
    plan: {
      code: IDENTIFICATION.PMOC.code,
      name: 'Edifício Aurora — Torre A',
      status: 'ACTIVE',
      coverageStart: '01/01/2026',
      coverageEnd: '31/12/2026',
      cadence: 'a cada 3 meses',
      serviceTypes: [
        'Limpeza de serpentina',
        'Higienização',
        'Troca de filtros',
      ],
      notes: 'Acesso ao shaft técnico somente com acompanhamento da zeladoria.',
      technicalResponsible: 'Helena Braga',
      fieldTechnician: 'Rafael Nunes',
      nextDueOn: '10/06/2026',
      lastExecutedAt: '10/03/2026',
    },
    customer: { name: CUSTOMER.name, document: CUSTOMER.document },
    equipment: EQUIPMENT,
    units: [{ name: 'Pavimento térreo', checklist: 'Roteiro trimestral' }],
    procedure: [
      {
        group: 'Unidade evaporadora',
        items: ['Limpar filtros', 'Higienizar bandeja', 'Medir temperatura'],
      },
    ],
    legalReference: 'Documento emitido nos termos da Lei nº 13.589/2018.',
  };
}
