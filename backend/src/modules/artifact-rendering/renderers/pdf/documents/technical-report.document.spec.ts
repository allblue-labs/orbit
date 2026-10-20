/**
 * O laudo técnico.
 *
 * Três coisas fazem um laudo ser um laudo, e são as três que este teste
 * guarda: o objeto delimitado, a conclusão em destaque e o registro
 * profissional de quem a assina. As ressalvas entram junto, porque esconder
 * limitação é o que transforma um laudo em problema depois.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText } from '../../../../../../test/support/pdf-text';

function entrada(
  options: { semRessalvas?: boolean; semCredencial?: boolean } = {},
): RenderInput {
  return {
    execution: {
      id: 'e',
      code: 'LT-000014',
      title: 'Avaliação de falha recorrente no chiller',
      status: 'COMPLETED',
    },
    snapshot: {
      id: 's',
      templateKey: 'ORBIT_RELATORIO_TECNICO',
      templateName: 'Relatório Técnico',
      templateVersion: 2,
      artifactType: 'RELATORIO_TECNICO',
      structureHash: 'h',
    },
    sections: [
      {
        id: 'objeto',
        title: 'Objeto e metodologia',
        order: 1,
        type: 'FORM',
        fields: [
          {
            id: 'objeto',
            label: 'Objeto do relatório',
            type: 'LONG_TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Avaliação das paradas do chiller de 120 TR.',
          },
          {
            id: 'metodologia',
            label: 'Metodologia aplicada',
            type: 'LONG_TEXT',
            order: 2,
            required: false,
            hidden: false,
            value: 'Medição de pressões com manifold calibrado.',
          },
          {
            id: 'normas',
            label: 'Normas de referência',
            type: 'LONG_TEXT',
            order: 3,
            required: false,
            hidden: false,
            value: 'ABNT NBR 16401-1:2008.',
          },
        ],
      },
      {
        id: 'analise',
        title: 'Análise',
        order: 2,
        type: 'FORM',
        fields: [
          {
            id: 'constatacoes',
            label: 'Constatações',
            type: 'LONG_TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Incrustação severa no enchimento da torre.',
          },
          {
            id: 'conclusao',
            label: 'Conclusão',
            type: 'LONG_TEXT',
            order: 2,
            required: true,
            hidden: false,
            value: 'A restrição está no sistema de condensação.',
          },
          ...(options.semRessalvas
            ? []
            : [
                {
                  id: 'ressalvas',
                  label: 'Ressalvas',
                  type: 'LONG_TEXT',
                  order: 3,
                  required: false,
                  hidden: false,
                  value: 'Não foi possível ensaiar a bomba sob carga plena.',
                },
              ]),
        ],
      },
    ],
    signatures: [
      {
        slotId: 'rt',
        label: 'Responsável técnico',
        signerRole: 'TECHNICAL_MANAGER',
        required: true,
        order: 1,
        signerName: 'Helena Braga',
        professionalCredential: options.semCredencial
          ? undefined
          : 'Eng.ª Mecânica · CREA-PE 1234543434',
      },
    ],
    branding: { primaryColor: '#1B4DB1' },
    layout: {},
    metadata: {
      documentContext: {
        emitter: { tradeName: 'Clima Norte' },
        customer: { name: 'Edifício Aurora' },
        operation: { code: 'OP-000091' },
      },
    },
    correlationId: 'c',
    generatedAt: new Date('2026-09-25T19:00:00.000Z'),
  };
}

describe('Laudo Técnico premium', () => {
  const renderer = new ArtifactPremiumPdfRenderer();

  it('nomeia o documento como laudo, não como relatório genérico', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Laudo Técnico');
    expect(texto).toContain('LT-000014');
  });

  it('delimita o objeto, separado da metodologia', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    /* O objeto é o que delimita o laudo: o que está fora dele não foi
       examinado, e misturá-lo com o método apaga essa fronteira. */
    expect(texto).toContain('Objeto do laudo');
    expect(texto).toContain('MÉTODO APLICADO');
    expect(texto).toContain('NORMAS DE REFERÊNCIA');
  });

  it('põe a conclusão em destaque, depois das constatações', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    const constatacao = texto.indexOf('Incrustação severa');
    const conclusao = texto.indexOf('A restrição está no sistema');
    expect(constatacao).toBeGreaterThan(-1);
    expect(conclusao).toBeGreaterThan(constatacao);
    expect(texto).toContain('PARECER TÉCNICO');
  });

  it('imprime as ressalvas em seção visível', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    /* Esconder limitação é o que transforma um laudo em problema depois. */
    expect(texto).toContain('Ressalvas e limitações');
    expect(texto).toContain('Não foi possível ensaiar a bomba');
  });

  it('não inventa ressalva quando o laudo não declarou nenhuma', async () => {
    const texto = pdfText(
      (await renderer.render(entrada({ semRessalvas: true }))).bytes,
    );

    expect(texto).not.toContain('Ressalvas e limitações');
  });

  it('dá seção própria ao registro profissional', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    /* É o registro que dá validade ao laudo; em corpo 7 ao lado do nome ele
       é fácil demais de não ver. Sai duas vezes de propósito: na
       identificação, onde quem confere procura, e na responsabilidade
       técnica, ao pé da assinatura. Contar é o que distingue as duas — só
       afirmar a presença passaria com o cartão do pé ausente. */
    expect(texto).toContain('Responsabilidade técnica');
    expect(texto.match(/REGISTRO PROFISSIONAL/g) ?? []).toHaveLength(2);
    expect(texto).toContain('CREA-PE 1234543434');
  });

  it('não abre o cartão de registro quando não há credencial', async () => {
    const texto = pdfText(
      (await renderer.render(entrada({ semCredencial: true }))).bytes,
    );

    expect(texto).toContain('Responsabilidade técnica');
    /* Um rótulo "Registro profissional" sobre um traço sugere que o dado se
       perdeu; o que houve foi não existir. */
    expect(texto).not.toContain('REGISTRO PROFISSIONAL');
    expect(texto).toContain('Helena Braga');
  });

  it('traduz a situação para quem recebe o laudo', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Emitido');
    expect(texto).not.toContain('COMPLETED');
  });
});
