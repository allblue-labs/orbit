/**
 * E2E do Rendering Engine.
 *
 * Percorre o ciclo inteiro contra a aplicação montada:
 *
 * ```
 * execução ──▶ POST /render (202) ──▶ worker ──▶ manifest emitido ──▶ storage
 *                                                       │
 *                                            renderStatus = READY
 * ```
 *
 * O que só este teste alcança:
 *
 * - a rota devolve **202 e não espera** o documento;
 * - a idempotência é do índice único do Postgres, não de uma checagem no código;
 * - o worker reabre a RLS do tenant e consegue ler a execução;
 * - o documento emitido é o mesmo que o renderer produziu, byte a byte;
 * - `renderStatus` percorre PENDING → RENDERING → READY de verdade.
 *
 * O worker é **desligado por configuração** e acionado por `tick()`: esperar um
 * laço de dois segundos tornaria o teste lento e intermitente.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';

const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

function cnpj(): string {
  const base = digits(8) + '0001';
  const check = (numbers: string): number => {
    const weights =
      numbers.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = numbers
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * weights[index]!,
        0,
      );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
}

describe('Artifact Rendering (e2e)', () => {
  let app: INestApplication<App>;
  let worker: BackgroundJobWorker;
  let token: string;
  let executionId: string;
  let http: () => request.Agent;

  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-render-e2e-'),
    );
    /** O teste controla quando o trabalho acontece. */
    process.env.JOBS_WORKER_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    worker = app.get(BackgroundJobWorker);
    http = () => request(app.getHttpServer());

    const suffix = randomUUID().slice(0, 8);
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email: `render.e2e.${suffix}@orbit.local`,
        firstName: 'Render',
        lastName: 'E2E',
        password: 'Orbit#Render@2026',
        organizationName: `Render E2E ${suffix}`,
        legalName: `Render E2E ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);

    token = (registration.body as { data: { accessToken: string } }).data
      .accessToken;

    const units = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const businessUnitId = (
      units.body as { data: { businessUnits: { id: string }[] } }
    ).data.businessUnits[0]!.id;

    const template = await auth(http().post('/api/v1/artifact-templates'))
      .send({
        key: `RENDER_${digits(6)}`,
        name: 'Template de renderização',
        artifactType: 'RELATORIO_TECNICO',
        sections: [
          {
            id: 'analise',
            title: 'Análise',
            order: 1,
            type: 'FORM',
            fields: [
              { id: 'local', label: 'Local', type: 'TEXT', order: 1 },
              {
                id: 'conclusao',
                label: 'Conclusão',
                type: 'LONG_TEXT',
                order: 2,
              },
            ],
          },
        ],
        signatureSlots: [],
        layout: { reusableBlocks: [] },
        metadata: {},
      })
      .expect(201);

    const templateId = (template.body as { data: { id: string } }).data.id;
    await auth(
      http().post(`/api/v1/artifact-templates/${templateId}/activate`),
    ).expect(201);

    const execution = await auth(http().post('/api/v1/artifact-executions'))
      .send({
        businessUnitId,
        templateId,
        code: `RND-${digits(6)}`,
        title: 'Execução para renderizar',
      })
      .expect(201);

    executionId = (execution.body as { data: { id: string } }).data.id;

    /** Uma resposta real, para o documento ter conteúdo do tenant. */
    await auth(
      http().put(`/api/v1/artifact-executions/${executionId}/responses`),
    )
      .send({
        sectionId: 'analise',
        fieldId: 'local',
        value: 'Sala de máquinas',
      })
      .expect(200);

    await auth(
      http().patch(`/api/v1/artifact-executions/${executionId}/status`),
    )
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    await auth(
      http().patch(`/api/v1/artifact-executions/${executionId}/status`),
    )
      .send({ status: 'UNDER_REVIEW' })
      .expect(200);
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('começa sem renderização', async () => {
    const response = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/render`),
    ).expect(200);

    const state = (response.body as { data: Record<string, unknown> }).data;
    expect(state.renderStatus).toBe('NOT_RENDERED');
    expect(state.completedAt).toBeNull();
  });

  /**
   * O preview roda **antes** de qualquer renderização deste arquivo, de
   * propósito: é o caso que importa. Quem quer ver como está ficando quer ver
   * justamente antes de emitir, quando não há manifesto, revisão nem arquivo
   * no storage para cair de volta.
   */
  it('desenha o rascunho sem emitir nada', async () => {
    const response = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/preview`),
    ).expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.headers['content-disposition']).toContain('rascunho');
    /* Um rascunho em cache mostraria as respostas de dez minutos atrás. */
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).toBeInstanceOf(Buffer);
    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const estado = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/render`),
    ).expect(200);
    expect(
      (estado.body as { data: { renderStatus: string } }).data.renderStatus,
    ).toBe('NOT_RENDERED');

    const revisoes = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);
    expect(
      (revisoes.body as { data: { data: unknown[] } }).data.data,
    ).toHaveLength(0);
  });

  it('o rascunho respeita o motor pedido', async () => {
    const response = await auth(
      http()
        .get(`/api/v1/artifact-executions/${executionId}/preview`)
        .query({ renderer: 'html.default' }),
    ).expect(200);

    expect(response.headers['content-type']).toContain('text/html');
  });

  it('não desenha rascunho sem sessão', async () => {
    await http()
      .get(`/api/v1/artifact-executions/${executionId}/preview`)
      .expect(401);
  });

  it('recusa renderizador desconhecido antes de enfileirar', async () => {
    const response = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/render`),
    )
      .send({ renderer: 'inexistente' })
      .expect(400);

    const error = (
      response.body as { error: { code: string; message: string } }
    ).error;
    expect(error).toEqual({
      code: 'RENDERER_NOT_SUPPORTED',
      message: 'O formato de documento solicitado não está disponível.',
      status: 400,
    });
    expect(JSON.stringify(error)).not.toMatch(/html\.default|pdf\.default/);
  });

  it('aceita o pedido e responde 202 sem esperar o documento', async () => {
    const response = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/render`),
    )
      .send({ renderer: 'pdf.default' })
      .expect(202);

    const state = (response.body as { data: Record<string, unknown> }).data;
    expect(state.renderStatus).toBe('PENDING');
    expect(state.jobId).toEqual(expect.any(String));
    expect(state.correlationId).toEqual(expect.any(String));
  });

  it('pedir de novo devolve o mesmo job — idempotência do banco', async () => {
    const first = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/render`),
    )
      .send({ renderer: 'pdf.default' })
      .expect(202);
    const second = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/render`),
    )
      .send({ renderer: 'pdf.default' })
      .expect(202);

    const jobOf = (response: request.Response) =>
      (response.body as { data: { jobId: string } }).data.jobId;

    expect(jobOf(second)).toBe(jobOf(first));
  });

  it('o worker renderiza, emite o manifest e marca READY', async () => {
    /**
     * Um ciclo reivindica um job **por fila**. Desde que a emissão do manifest
     * publica o evento `artifact.manifest.issued`, o mesmo ciclo pode fechar
     * duas coisas: a renderização e o evento que ela originou. O que este
     * teste protege é a renderização — as asserções seguintes.
     */
    expect(await worker.tick()).toBeGreaterThanOrEqual(1);

    const status = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/render`),
    ).expect(200);
    const state = (status.body as { data: Record<string, unknown> }).data;

    expect(state.renderStatus).toBe('READY');
    expect(state.completedAt).not.toBeNull();
    expect(state.error).toBeNull();

    const manifests = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);
    const list = (
      manifests.body as {
        data: {
          data: {
            id: string;
            revision: number;
            status: string;
            isActive: boolean;
            renderer: string;
            format: string;
            contentHash: string;
          }[];
          meta: { activeRevision: number };
        };
      }
    ).data;

    expect(list.meta.activeRevision).toBe(1);
    const active = list.data.find((item) => item.isActive);
    expect(active?.status).toBe('ISSUED');
    expect(active?.renderer).toBe('pdf.default');
    expect(active?.format).toBe('PDF');
    expect(active?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  }, 60000);

  it('o documento no storage é o PDF que o renderer produziu', async () => {
    const manifests = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);
    const active = (
      manifests.body as {
        data: {
          data: { id: string; isActive: boolean; contentHash: string }[];
        };
      }
    ).data.data.find((item) => item.isActive);

    const signed = await auth(
      http().get(`/api/v1/artifact-manifests/${active?.id}/download`),
    ).expect(200);
    const url = new URL((signed.body as { data: { url: string } }).data.url);

    const download = await http()
      .get(`${url.pathname}${url.search}`)
      .expect(200);
    const bytes = Buffer.from(download.body as Buffer);

    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    /** O hash publicado é o do conteúdo que está no storage. */
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      active?.contentHash,
    );
  }, 30000);

  it('renderizar de novo abre a revisão seguinte e aposenta a anterior', async () => {
    await auth(http().post(`/api/v1/artifact-executions/${executionId}/render`))
      .send({ renderer: 'html.default' })
      .expect(202);

    /**
     * Um ciclo reivindica um job **por fila**. Desde que a emissão do manifest
     * publica o evento `artifact.manifest.issued`, o mesmo ciclo pode fechar
     * duas coisas: a renderização e o evento que ela originou. O que este
     * teste protege é a renderização — as asserções seguintes.
     */
    expect(await worker.tick()).toBeGreaterThanOrEqual(1);

    const manifests = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);
    const list = (
      manifests.body as {
        data: {
          data: {
            revision: number;
            status: string;
            isActive: boolean;
            format: string;
          }[];
          meta: { total: number; activeRevision: number };
        };
      }
    ).data;

    expect(list.meta.total).toBe(2);
    expect(list.meta.activeRevision).toBe(2);
    expect(list.data.find((item) => item.revision === 1)?.status).toBe(
      'SUPERSEDED',
    );
    expect(list.data.find((item) => item.revision === 2)?.format).toBe('HTML');
    /** Só uma revisão ativa — invariante do banco, da PR-19. */
    expect(list.data.filter((item) => item.isActive)).toHaveLength(1);
  }, 60000);

  it('publica contadores de observabilidade', async () => {
    const response = await auth(
      http().get('/api/v1/artifact-rendering/metrics'),
    ).expect(200);

    const metrics = (
      response.body as {
        data: {
          started: number;
          succeeded: number;
          renderers: string[];
          defaultRenderer: string;
          byRenderer: Record<string, { succeeded: number }>;
        };
      }
    ).data;

    expect(metrics.succeeded).toBeGreaterThanOrEqual(2);
    expect(metrics.renderers).toEqual(
      expect.arrayContaining(['html.default', 'pdf.default', 'pdf.premium']),
    );
    /* A tela pré-seleciona por este campo; se ele sumir, o preview passa a
       mostrar um documento diferente do que a emissão produziria. */
    expect(metrics.defaultRenderer).toBe('pdf.premium');
    expect(metrics.byRenderer['pdf.default']!.succeeded).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('não renderiza sem sessão', async () => {
    await http()
      .post(`/api/v1/artifact-executions/${executionId}/render`)
      .send({ renderer: 'pdf.default' })
      .expect(401);
  });
});
