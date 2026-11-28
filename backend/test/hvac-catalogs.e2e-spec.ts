import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
/**
 * O catálogo inicial de refrigeração e climatização.
 *
 * Toda organização nova já tem roteiros de atendimento, unidades do PMOC
 * ligadas aos seus roteiros e visitas de RVT com roteiro — e é só ponto de
 * partida: a função não sobrescreve o que a empresa editou nem traz de volta
 * o que ela removeu. Contra o PostgreSQL real, com o papel de runtime.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { ChecklistItemDto } from '../src/modules/operations/checklist.dto';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const PASSWORD = 'Orbit#Catalogo@2026';

describe('Catálogo inicial de climatização (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  let token: string;
  let organizationId: string;

  const api = () => request(app.getHttpServer());
  const get = async (path: string) =>
    (
      await api()
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.data;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');

    const first = await registerOrganization();
    token = first.token;
    organizationId = first.organizationId;
  });

  /** Uma organização pelo cadastro real — o caminho que chama a função. */
  async function registerOrganization() {
    const suffix = randomUUID().slice(0, 8);
    const email = `catalogo.${suffix}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      firstName: 'Catálogo',
      lastName: 'Owner',
      password: PASSWORD,
      organizationName: `Clima ${suffix}`,
      legalName: `Clima ${suffix} LTDA`,
      documentType: 'CNPJ',
      documentNumber: cnpj(),
      city: 'Recife',
      street: 'Rua Fria',
      stateCode: 'PE',
      planKey: 'ENTERPRISE_UNLIMITED',
    });
    await paidSubscriptionFixture(app, prisma, email);
    const user = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      select: {
        organizationMemberships: { select: { organizationId: true } },
      },
    });
    return {
      token: registration.body.data.accessToken as string,
      organizationId: user.organizationMemberships[0]!.organizationId,
    };
  }

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('a organização nova já tem os roteiros, válidos para o cadastro', async () => {
    const page = await get('/checklist-templates?latestOnly=true&limit=100');
    const templates: any[] = Array.isArray(page) ? page : page.data;
    const keys = templates.map((t) => t.key);
    for (const key of [
      'MANUTENCAO_PREVENTIVA',
      'MANUTENCAO_CORRETIVA',
      'INSTALACAO_SPLIT',
      'HIGIENIZACAO_COMPLETA',
      'VISTORIA_LAUDO',
      'REFRIGERACAO_COMERCIAL',
      'DESINSTALACAO',
      'PMOC_CONDENSADORA',
      'PMOC_EVAPORADORA',
      'PMOC_CHILLER',
    ])
      expect(keys).toContain(key);

    const rows = await prisma.checklistTemplate.findMany({
      where: { organizationId },
    });
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row.isActive).toBe(true);
      expect(row.isGeneral).toBe(false);
      const items = row.items as unknown[];
      expect(items.length).toBeGreaterThan(0);
      const keysOfItems = new Set<string>();
      for (const raw of items) {
        /* O mesmo contrato que o cadastro pela tela exige. */
        const item = plainToInstance(ChecklistItemDto, raw);
        expect(validateSync(item)).toEqual([]);
        expect(item.key).toBe(item.key.toLowerCase());
        expect(keysOfItems.has(item.key)).toBe(false);
        keysOfItems.add(item.key);
        if (item.type === 'SELECT')
          expect(item.options?.length).toBeGreaterThan(0);
      }
    }
    const preventiva = rows.find((r) => r.key === 'MANUTENCAO_PREVENTIVA')!;
    expect(preventiva.operationKind).toBe('MAINTENANCE');
    expect(rows.find((r) => r.key === 'INSTALACAO_SPLIT')!.operationKind).toBe(
      'INSTALLATION',
    );
    expect(rows.find((r) => r.key === 'VISTORIA_LAUDO')!.operationKind).toBe(
      'INSPECTION',
    );
  });

  it('as unidades do PMOC chegam, cada uma com o seu roteiro', async () => {
    const page = await get('/pmoc/units');
    const units: any[] = Array.isArray(page) ? page : page.data;
    expect(units.map((u) => u.key)).toEqual([
      'UNIDADE_CONDENSADORA',
      'UNIDADE_EVAPORADORA',
      'DUTOS_DIFUSORES',
      'FAN_COIL',
      'SELF_CONTAINED',
      'CHILLER',
      'TORRE_RESFRIAMENTO',
      'QUADRO_ELETRICO',
      'RENOVACAO_AR',
    ]);
    const rows = await prisma.pmocUnit.findMany({
      where: { organizationId },
      include: { checklistTemplate: { select: { key: true } } },
    });
    expect(
      Object.fromEntries(rows.map((u) => [u.key, u.checklistTemplate?.key])),
    ).toMatchObject({
      UNIDADE_CONDENSADORA: 'PMOC_CONDENSADORA',
      UNIDADE_EVAPORADORA: 'PMOC_EVAPORADORA',
      CHILLER: 'PMOC_CHILLER',
      RENOVACAO_AR: 'PMOC_RENOVACAO_AR',
    });
  });

  it('as visitas de RVT seguem a preventiva, com o ritmo quadrimestral', async () => {
    const rows = await prisma.rvtMaintenanceType.findMany({
      where: { organizationId },
      include: { checklistTemplate: { select: { key: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    expect(rows.map((r) => r.label)).toEqual([
      'Semanal',
      'Quinzenal',
      'Mensal',
      'Bimestral',
      'Trimestral',
      'Quadrimestral',
      'Semestral',
      'Anual',
    ]);
    expect(rows.find((r) => r.key === 'FOUR_MONTHLY')?.intervalMonths).toBe(4);
    expect(new Set(rows.map((r) => r.checklistTemplate?.key))).toEqual(
      new Set(['MANUTENCAO_PREVENTIVA']),
    );
    const types = await get('/rvt/maintenance-types');
    expect((Array.isArray(types) ? types : types.data).length).toBe(8);
  });

  it('é ponto de partida: não sobrescreve edição nem traz de volta o removido', async () => {
    await prisma.checklistTemplate.updateMany({
      where: { organizationId, key: 'MANUTENCAO_CORRETIVA' },
      data: { name: 'Corretiva da casa' },
    });
    await prisma.pmocUnit.update({
      where: { organizationId_key: { organizationId, key: 'CHILLER' } },
      data: { deletedAt: new Date(), isActive: false },
    });
    const outroRoteiro = await prisma.checklistTemplate.findFirstOrThrow({
      where: { organizationId, key: 'HIGIENIZACAO_COMPLETA' },
    });
    await prisma.rvtMaintenanceType.update({
      where: { organizationId_key: { organizationId, key: 'MONTHLY' } },
      data: { checklistTemplateId: outroRoteiro.id },
    });

    /* Rodar de novo — como a restauração pós-retenção faria. */
    await prisma.$executeRaw`SELECT app_seed_hvac_catalogs(${organizationId}::uuid)`;

    expect(
      await prisma.checklistTemplate.count({ where: { organizationId } }),
    ).toBe(16);
    expect(
      (
        await prisma.checklistTemplate.findFirstOrThrow({
          where: { organizationId, key: 'MANUTENCAO_CORRETIVA' },
        })
      ).name,
    ).toBe('Corretiva da casa');
    const chiller = await prisma.pmocUnit.findUniqueOrThrow({
      where: { organizationId_key: { organizationId, key: 'CHILLER' } },
    });
    expect(chiller.deletedAt).not.toBeNull();
    expect(await prisma.pmocUnit.count({ where: { organizationId } })).toBe(9);
    expect(
      (
        await prisma.rvtMaintenanceType.findUniqueOrThrow({
          where: { organizationId_key: { organizationId, key: 'MONTHLY' } },
        })
      ).checklistTemplateId,
    ).toBe(outroRoteiro.id);
  });

  it('respeita o que a organização já tinha com a mesma chave', async () => {
    /* Os exemplos do staging: preventiva própria e unidades com ela. */
    const outra = { id: (await registerOrganization()).organizationId };
    await prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.deleteMany({
        where: { organizationId: outra.id },
      });
      await tx.pmocUnit.deleteMany({ where: { organizationId: outra.id } });
      const propria = await tx.checklistTemplate.create({
        data: {
          organizationId: outra.id,
          key: 'MANUTENCAO_PREVENTIVA',
          name: 'Preventiva própria',
          isGeneral: true,
          items: [
            {
              key: 'filtros',
              label: 'Filtros',
              type: 'BOOLEAN',
              required: true,
            },
          ],
        },
      });
      await tx.pmocUnit.create({
        data: {
          organizationId: outra.id,
          key: 'UNIDADE_CONDENSADORA',
          name: 'Condensadora própria',
          checklistTemplateId: propria.id,
        },
      });
      await tx.rvtMaintenanceType.updateMany({
        where: { organizationId: outra.id },
        data: { checklistTemplateId: null },
      });
    });

    await prisma.$executeRaw`SELECT app_seed_hvac_catalogs(${outra.id}::uuid)`;

    const preventiva = await prisma.checklistTemplate.findMany({
      where: { organizationId: outra.id, key: 'MANUTENCAO_PREVENTIVA' },
    });
    expect(preventiva).toHaveLength(1);
    expect(preventiva[0]!.name).toBe('Preventiva própria');
    const condensadora = await prisma.pmocUnit.findUniqueOrThrow({
      where: {
        organizationId_key: {
          organizationId: outra.id,
          key: 'UNIDADE_CONDENSADORA',
        },
      },
    });
    expect(condensadora.name).toBe('Condensadora própria');
    expect(condensadora.checklistTemplateId).toBe(preventiva[0]!.id);
    /* As visitas usam a preventiva da própria empresa. */
    const tipos = await prisma.rvtMaintenanceType.findMany({
      where: { organizationId: outra.id, deletedAt: null },
    });
    expect(new Set(tipos.map((t) => t.checklistTemplateId))).toEqual(
      new Set([preventiva[0]!.id]),
    );
  });
});

function cnpj(): string {
  const base =
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('') +
    '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce((sum, item, index) => sum + Number(item) * weights[index]!, 0) %
      11;
    return rest < 2 ? `${0}` : `${11 - rest}`;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
