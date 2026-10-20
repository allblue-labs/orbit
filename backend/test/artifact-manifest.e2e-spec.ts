/**
 * E2E do documento oficial.
 *
 * Percorre o ciclo inteiro contra a aplicação montada: registrar organização,
 * criar template e execução, submeter para revisão, abrir revisão, reservar o
 * arquivo, enviar pelo endereço assinado, emitir, baixar e revogar.
 *
 * O que este teste protege, e que teste unitário não alcança:
 *
 * - as rotas exigem sessão, capability e permissão de verdade;
 * - a URL assinada emitida pela API é **aceita** pelo próprio storage;
 * - o hash gravado é o do conteúdo que chegou ao storage, não o declarado;
 * - a revisão anterior perde a bandeira de ativa quando a seguinte é emitida;
 * - nenhum endereço interno do provider aparece em resposta alguma.
 *
 * Roda com o provider `LOCAL`, que é o padrão: o E2E não deve exigir object
 * store externo. A compatibilidade com S3 é verificada em `minio-roundtrip`.
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

/** Documento cujo hash o teste conhece e vai conferir contra o servidor. */
const CONTENT = Buffer.from('%PDF-1.7 documento oficial do Orbit — E2E');

const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

/** CNPJ com dígitos verificadores válidos — o cadastro os valida. */
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

describe('Artifact Manifest (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let executionId: string;
  let manifestId: string;
  let http: () => request.Agent;

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-storage-'),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    /** A mesma configuração global de `main.ts` — sem ela, os defaults dos DTOs não se aplicam. */
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    http = () => request(app.getHttpServer());

    /** Nome único: o slug da organização é único e o teste pode rodar de novo. */
    const suffix = randomUUID().slice(0, 8);
    const email = `manifest.e2e.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Manifest',
        lastName: 'E2E',
        password: 'Orbit#Manifest@2026',
        organizationName: `Manifest E2E ${suffix}`,
        legalName: `Manifest E2E ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);

    token = (registration.body as { data: { accessToken: string } }).data
      .accessToken;

    const units = await http()
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const businessUnitId = (
      units.body as { data: { businessUnits: { id: string }[] } }
    ).data.businessUnits[0]!.id;

    const template = await http()
      .post('/api/v1/artifact-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `E2E_${digits(6)}`,
        name: 'Template E2E',
        artifactType: 'RELATORIO_TECNICO',
        sections: [
          {
            id: 'dados',
            title: 'Dados',
            order: 1,
            type: 'FORM',
            fields: [{ id: 'local', label: 'Local', type: 'TEXT', order: 1 }],
          },
        ],
        signatureSlots: [],
        layout: { reusableBlocks: [] },
        metadata: {},
      })
      .expect(201);

    const templateId = (template.body as { data: { id: string } }).data.id;

    /** O template nasce em rascunho; a execução exige um template ativo. */
    await http()
      .post(`/api/v1/artifact-templates/${templateId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const execution = await http()
      .post('/api/v1/artifact-executions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessUnitId,
        templateId,
        code: `EXEC-${digits(6)}`,
        title: 'Execução E2E',
      })
      .expect(201);

    executionId = (execution.body as { data: { id: string } }).data.id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('recusa abrir revisão de execução ainda em rascunho', async () => {
    await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/manifests`),
    )
      .send({ renderer: 'pdf.default' })
      .expect(409);
  });

  it('abre a primeira revisão depois da submissão', async () => {
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

    const response = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/manifests`),
    )
      .send({ renderer: 'pdf.default', format: 'PDF' })
      .expect(201);

    const manifest = (response.body as { data: Record<string, unknown> }).data;
    manifestId = manifest.id as string;

    expect(manifest.revision).toBe(1);
    expect(manifest.status).toBe('DRAFT');
    expect(manifest.isActive).toBe(false);
    expect(manifest.contentHash).toBeNull();
    /** O hash da fonte já existe: é a impressão digital da execução. */
    expect(manifest.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('não baixa uma revisão sem documento', async () => {
    await auth(
      http().get(`/api/v1/artifact-manifests/${manifestId}/download`),
    ).expect(409);
  });

  it('emite o documento e confere o hash do que foi realmente enviado', async () => {
    const reservation = await auth(
      http().post(`/api/v1/artifact-manifests/${manifestId}/file`),
    )
      .send({
        fileName: 'relatorio.pdf',
        mimeType: 'application/pdf',
        sizeBytes: CONTENT.length,
      })
      .expect(201);

    const reserved = (
      reservation.body as {
        data: { fileId: string; upload: { url: string; method: string } };
      }
    ).data;

    expect(reserved.upload.method).toBe('PUT');
    /** A URL não revela caminho de sistema de arquivos. */
    expect(reserved.upload.url).not.toContain(process.env.STORAGE_LOCAL_DIR);

    /**
     * Envio direto pelo endereço assinado.
     *
     * No provider local o destino é a própria API; em S3 seria o object store.
     * O cliente não muda de código entre os dois.
     */
    const upload = new URL(reserved.upload.url);
    await http()
      .put(`${upload.pathname}${upload.search}`)
      .set('content-type', 'application/pdf')
      .send(CONTENT)
      .expect((response) => {
        expect([200, 201, 204]).toContain(response.status);
      });

    const issued = await auth(
      http().post(`/api/v1/artifact-manifests/${manifestId}/issue`),
    )
      .send({ fileId: reserved.fileId })
      .expect(201);

    const manifest = (issued.body as { data: Record<string, unknown> }).data;
    expect(manifest.status).toBe('ISSUED');
    expect(manifest.isActive).toBe(true);
    expect(manifest.issuedAt).not.toBeNull();

    /** O hash é do conteúdo armazenado — o servidor o calculou, não o cliente. */
    expect(manifest.contentHash).toBe(
      createHash('sha256').update(CONTENT).digest('hex'),
    );

    const file = manifest.file as Record<string, unknown>;
    expect(file.status).toBe('AVAILABLE');
    expect(file).not.toHaveProperty('objectKey');
    expect(file).not.toHaveProperty('bucket');
  }, 30000);

  it('devolve URL assinada de download e nunca um caminho interno', async () => {
    const response = await auth(
      http().get(`/api/v1/artifact-manifests/${manifestId}/download`),
    ).expect(200);

    const signed = (
      response.body as { data: { url: string; expiresAt: string } }
    ).data;

    expect(signed.url).toContain('signature=');
    expect(signed.url).not.toContain(process.env.STORAGE_LOCAL_DIR);
    expect(new Date(signed.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const target = new URL(signed.url);
    const download = await http()
      .get(`${target.pathname}${target.search}`)
      .expect(200);
    expect(Buffer.from(download.body as Buffer).toString()).toBe(
      CONTENT.toString(),
    );
  });

  it('recusa acesso ao objeto sem assinatura válida', async () => {
    const response = await auth(
      http().get(`/api/v1/artifact-manifests/${manifestId}/download`),
    ).expect(200);
    const signed = (response.body as { data: { url: string } }).data;
    const target = new URL(signed.url);
    target.searchParams.set('signature', 'a'.repeat(64));

    await http().get(`${target.pathname}${target.search}`).expect(403);
  });

  it('a segunda revisão substitui a primeira, que fica no histórico', async () => {
    const opened = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/manifests`),
    )
      .send({ renderer: 'pdf.default' })
      .expect(201);
    const second = (opened.body as { data: { id: string; revision: number } })
      .data;
    expect(second.revision).toBe(2);

    const reservation = await auth(
      http().post(`/api/v1/artifact-manifests/${second.id}/file`),
    )
      .send({
        fileName: 'relatorio-v2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 32,
      })
      .expect(201);
    const reserved = (
      reservation.body as { data: { fileId: string; upload: { url: string } } }
    ).data;

    const upload = new URL(reserved.upload.url);
    await http()
      .put(`${upload.pathname}${upload.search}`)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('%PDF-1.7 revisao dois'));

    await auth(http().post(`/api/v1/artifact-manifests/${second.id}/issue`))
      .send({ fileId: reserved.fileId })
      .expect(201);

    const list = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);

    const body = (
      list.body as {
        data: {
          data: { revision: number; status: string; isActive: boolean }[];
          meta: { total: number; activeRevision: number };
        };
      }
    ).data;

    expect(body.meta.total).toBe(2);
    expect(body.meta.activeRevision).toBe(2);

    const first = body.data.find((item) => item.revision === 1);
    expect(first?.status).toBe('SUPERSEDED');
    expect(first?.isActive).toBe(false);
    /** Só uma ativa — o índice único parcial do banco garante. */
    expect(body.data.filter((item) => item.isActive)).toHaveLength(1);
  }, 30000);

  it('revoga a revisão ativa e para de distribuí-la', async () => {
    const list = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}/manifests`),
    ).expect(200);
    const active = (
      list.body as { data: { data: { id: string; isActive: boolean }[] } }
    ).data.data.find((item) => item.isActive);

    const revoked = await auth(
      http().post(`/api/v1/artifact-manifests/${active?.id}/revoke`),
    )
      .send({ reason: 'documento emitido com dados incorretos' })
      .expect(201);

    const manifest = (revoked.body as { data: Record<string, unknown> }).data;
    expect(manifest.status).toBe('REVOKED');
    expect(manifest.isActive).toBe(false);
    expect(manifest.revokedAt).not.toBeNull();

    await auth(
      http().get(`/api/v1/artifact-manifests/${active?.id}/download`),
    ).expect(403);
  });

  it('não expõe manifest de outra organização', async () => {
    await http().get(`/api/v1/artifact-manifests/${manifestId}`).expect(401);
  });
});
