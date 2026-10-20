/**
 * Snapshot → HTML.
 *
 * O renderer é uma função pura, então o teste é uma função: entrada conhecida,
 * saída conferida. A parte que mais importa é a de sanitização — um artefato é
 * preenchido em campo por pessoas, e o documento gerado é aberto por outras.
 */
import { ArtifactHtmlRenderer } from './artifact-html.renderer';
import { escapeHtml, formatAnswer, safeColor } from './html-safe';
import type { RenderInput } from '../artifact-renderer';

const base = (overrides: Partial<RenderInput> = {}): RenderInput => ({
  execution: {
    id: '019f-exec',
    code: 'OS-2026-001',
    title: 'Manutenção preventiva',
    status: 'UNDER_REVIEW',
    startedAt: '2026-08-03T10:00:00.000Z',
    completedAt: null,
  },
  snapshot: {
    id: '019f-snap',
    templateKey: 'ORBIT_PMOC',
    templateName: 'PMOC',
    templateVersion: 2,
    artifactType: 'PMOC',
    structureHash: 'a'.repeat(64),
  },
  sections: [
    {
      id: 'dados',
      title: 'Dados gerais',
      description: 'Identificação do local',
      order: 1,
      type: 'FORM',
      fields: [
        {
          id: 'local',
          label: 'Local',
          type: 'TEXT',
          order: 1,
          required: true,
          hidden: false,
          value: 'Sala de máquinas',
        },
        {
          id: 'temperatura',
          label: 'Temperatura',
          type: 'DECIMAL',
          order: 2,
          required: true,
          hidden: false,
          unit: '°C',
          value: 21.5,
        },
        {
          id: 'pendente',
          label: 'Umidade',
          type: 'DECIMAL',
          order: 3,
          required: true,
          hidden: false,
        },
        {
          id: 'oculto',
          label: 'Campo interno',
          type: 'TEXT',
          order: 4,
          required: false,
          hidden: true,
          value: 'não deve aparecer',
        },
      ],
    },
  ],
  signatures: [
    {
      slotId: 'tecnico',
      label: 'Técnico responsável',
      signerRole: 'TECHNICIAN',
      required: true,
      order: 1,
      signerName: 'Ana Souza',
      signerDocument: '123.456.789-00',
      signedAt: '2026-08-03T12:00:00.000Z',
      signatureHash: 'b'.repeat(64),
    },
    {
      slotId: 'cliente',
      label: 'Cliente',
      signerRole: 'CUSTOMER',
      required: true,
      order: 2,
    },
  ],
  branding: {
    organizationName: 'Allblue Labs',
    primaryColor: '#0055aa',
    footerText: 'Documento controlado',
  },
  layout: {},
  metadata: {},
  correlationId: '019f-correlation',
  generatedAt: new Date('2026-08-03T12:30:00.000Z'),
  ...overrides,
});

describe('ArtifactHtmlRenderer', () => {
  const renderer = new ArtifactHtmlRenderer();
  const html = async (input: RenderInput): Promise<string> =>
    (await renderer.render(input)).bytes.toString('utf8');

  it('declara identidade, formato e tipo de conteúdo', async () => {
    const output = await renderer.render(base());

    expect(renderer.id).toBe('html.default');
    expect(output.format).toBe('HTML');
    expect(output.mimeType).toContain('text/html');
    expect(output.rendererVersion).toBe(renderer.version);
  });

  it('compõe cabeçalho, seções, respostas, assinaturas e rodapé', async () => {
    const document = await html(base());

    expect(document).toContain('Allblue Labs');
    expect(document).toContain('Manutenção preventiva');
    expect(document).toContain('OS-2026-001');
    expect(document).toContain('Dados gerais');
    expect(document).toContain('Sala de máquinas');
    expect(document).toContain('21.5 °C');
    expect(document).toContain('Ana Souza');
    expect(document).toContain('Documento controlado');
    /** O hash da estrutura fecha o documento — é o que o liga ao snapshot. */
    expect(document).toContain('a'.repeat(64));
    expect(document).toContain('019f-correlation');
  });

  it('mostra ausência em vez de esconder o campo não respondido', async () => {
    const document = await html(base());

    expect(document).toContain('Umidade');
    expect(document).toContain('não respondido');
  });

  it('não desenha campo oculto', async () => {
    expect(await html(base())).not.toContain('não deve aparecer');
  });

  it('assinatura pendente aparece como pendente, não some', async () => {
    const document = await html(base());

    expect(document).toContain('Cliente');
    expect(document).toContain('aguardando assinatura');
  });

  it('respeita a ordem declarada, não a ordem do array', async () => {
    const input = base({
      sections: [
        { ...base().sections[0]!, id: 'b', title: 'Segunda', order: 2 },
        { ...base().sections[0]!, id: 'a', title: 'Primeira', order: 1 },
      ],
    });
    const document = await html(input);

    expect(document.indexOf('Primeira')).toBeLessThan(
      document.indexOf('Segunda'),
    );
  });

  it('marca quebra lógica para quem transformar em página', async () => {
    const document = await html(base());

    expect(document).toContain('break-inside:avoid');
    expect(document).toContain('page-break-inside:avoid');
  });

  describe('sanitização', () => {
    it('escapa marcação vinda de resposta', async () => {
      const input = base();
      const section = input.sections[0]!;
      const document = await html({
        ...input,
        sections: [
          {
            ...section,
            fields: [
              {
                ...section.fields[0]!,
                value: '<script>alert(1)</script>',
              },
            ],
          },
        ],
      });

      expect(document).not.toContain('<script>alert(1)</script>');
      expect(document).toContain('&lt;script&gt;');
    });

    it('escapa marcação vinda do próprio template', async () => {
      const input = base();
      const document = await html({
        ...input,
        sections: [
          {
            ...input.sections[0]!,
            title: '<img src=x onerror=alert(1)>',
          },
        ],
      });

      expect(document).not.toContain('<img src=x');
      expect(document).toContain('&lt;img');
    });

    it('escapa marcação vinda do branding e do nome de quem assina', async () => {
      const input = base();
      const document = await html({
        ...input,
        branding: {
          ...input.branding,
          organizationName: '</title><script>x</script>',
        },
        signatures: [{ ...input.signatures[0]!, signerName: '<b>Ana</b>' }],
      });

      expect(document).not.toContain('<script>x</script>');
      expect(document).not.toContain('<b>Ana</b>');
    });

    it('não emite script em nenhuma saída', async () => {
      expect(await html(base())).not.toMatch(/<script/i);
    });

    it('declara CSP restritiva no documento', async () => {
      expect(await html(base())).toContain("default-src 'none'");
    });

    it('recusa cor fora do formato hexadecimal', async () => {
      const document = await html(
        base({
          branding: {
            organizationName: 'X',
            primaryColor: 'red;}body{background:url(javascript:alert(1))',
          },
        }),
      );

      expect(document).not.toContain('javascript:');
    });
  });
});

describe('html-safe', () => {
  it('escapa os cinco caracteres que quebram marcação', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('trata ausência como travessão, não como vazio', () => {
    expect(formatAnswer(null)).toBe('—');
    expect(formatAnswer(undefined)).toBe('—');
    expect(formatAnswer('')).toBe('—');
    expect(formatAnswer([])).toBe('—');
  });

  it('formata os tipos que o contrato permite em `value`', () => {
    expect(formatAnswer(true)).toBe('Sim');
    expect(formatAnswer(false)).toBe('Não');
    expect(formatAnswer(12.5)).toBe('12.5');
    expect(formatAnswer(['a', 'b'])).toBe('a, b');
    expect(formatAnswer({ x: 1 })).toBe('{"x":1}');
  });

  it('aceita hexadecimal de 3 e 6 dígitos e recusa o resto', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('#A1B2C3')).toBe('#A1B2C3');
    expect(safeColor('rgb(0,0,0)')).toBe('#17213a');
    expect(safeColor('')).toBe('#17213a');
  });
});
