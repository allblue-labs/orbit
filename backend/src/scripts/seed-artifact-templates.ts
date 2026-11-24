/**
 * Semeadura do catálogo oficial de artefatos.
 *
 * Insere (ou atualiza) os templates **globais** do Orbit — os mesmos que a RLS
 * do PR-17 já previa ao permitir leitura de "future global catalog templates".
 *
 * ## Por que um script, e não uma migração
 *
 * Uma migração grava conteúdo editorial em SQL versionado: mudar o texto de um
 * campo viraria uma migração nova, e uma migração já aplicada não se corrige.
 * O script é idempotente e pode ser reexecutado a cada evolução do catálogo,
 * exatamente como `seed:platform-admin`.
 *
 * ## Idempotência
 *
 * A chave de reconciliação é `key` entre os templates **globais**
 * (`organizationId IS NULL`). Reexecutar:
 *
 * - cria o que falta;
 * - publica **versão nova** quando a estrutura mudou — nunca reescreve uma
 *   versão já publicada, porque alguma execução pode ter tirado snapshot dela;
 * - não toca em nada quando a estrutura é idêntica.
 *
 * As cópias que as organizações fizeram são independentes: duplicar cria um
 * template da organização, e este script nunca escreve fora de
 * `organizationId IS NULL`.
 */
import { directDatabaseUrl } from './direct-database-url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import {
  OFFICIAL_TEMPLATES,
  type OfficialSection,
  type OfficialSignatureSlot,
  type OfficialTemplate,
} from './artifact-templates/official-catalog';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const databaseUrl = directDatabaseUrl();

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

/** Forma completa da seção, com os padrões que o Read Model publica. */
function toSection(section: OfficialSection): Record<string, unknown> {
  return {
    id: section.id,
    title: section.title,
    description: section.description,
    order: section.order,
    type: section.type,
    required: section.required ?? false,
    visibility: 'VISIBLE',
    permissions: [],
    collapsible: false,
    configuration: {},
    fields: section.fields.map((field) => ({
      id: field.id,
      label: field.label,
      description: field.description,
      type: field.type,
      order: field.order,
      required: field.required ?? false,
      readOnly: false,
      hidden: false,
      validations: [],
      dependencies: [],
      placeholder: field.placeholder,
      unit: field.unit,
      configuration: {},
    })),
  };
}

function toSignatureSlot(slot: OfficialSignatureSlot): Record<string, unknown> {
  return {
    id: slot.id,
    label: slot.label,
    signerRole: slot.signerRole,
    order: slot.order,
    required: slot.required ?? false,
    visibility: 'VISIBLE',
    permissions: [],
    configuration: {},
  };
}

interface StructurePayload {
  metadata: Record<string, unknown>;
  sections: Record<string, unknown>[];
  signatureSlots: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

function toStructure(template: OfficialTemplate): StructurePayload {
  return {
    metadata: { official: true, catalog: 'orbit' },
    sections: template.sections.map(toSection),
    signatureSlots: template.signatureSlots.map(toSignatureSlot),
    layout: { reusableBlocks: [] },
  };
}

/** Assinatura estável da estrutura, para decidir se há o que publicar. */
function fingerprint(structure: StructurePayload): string {
  return createHash('sha256')
    .update(JSON.stringify(structure))
    .digest('hex')
    .slice(0, 32);
}

async function seed(): Promise<void> {
  const summary = { created: 0, versioned: 0, unchanged: 0 };

  await prisma.$transaction(async (tx) => {
    /** A RLS só permite escrever template global para administração da plataforma. */
    await tx.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      'app.is_platform_admin',
      'true',
    );

    for (const template of OFFICIAL_TEMPLATES) {
      const structure = toStructure(template);
      const hash = fingerprint(structure);

      const existing = await tx.artifactTemplate.findFirst({
        where: { organizationId: null, key: template.key },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });

      if (!existing) {
        await tx.artifactTemplate.create({
          data: {
            id: generateUuidV7(),
            organizationId: null,
            createdById: null,
            key: template.key,
            name: template.name,
            description: template.description,
            artifactType: template.artifactType,
            visibility: 'GLOBAL',
            status: 'ACTIVE',
            tags: template.tags,
            sortOrder: template.sortOrder,
            currentVersion: 1,
            versions: {
              create: {
                id: generateUuidV7(),
                organizationId: null,
                createdById: null,
                version: 1,
                metadata: { ...structure.metadata, fingerprint: hash },
                sections: structure.sections as Prisma.InputJsonValue,
                signatureSlots:
                  structure.signatureSlots as Prisma.InputJsonValue,
                layout: structure.layout as Prisma.InputJsonValue,
                changeSummary: 'Catálogo oficial do Orbit',
              },
            },
          },
        });
        summary.created += 1;
        continue;
      }

      const latest = existing.versions[0];
      const currentHash =
        latest && typeof latest.metadata === 'object' && latest.metadata
          ? (latest.metadata as Record<string, unknown>).fingerprint
          : undefined;

      /** Metadados do template mudam sem publicar versão — não são estrutura. */
      await tx.artifactTemplate.update({
        where: { id: existing.id },
        data: {
          name: template.name,
          description: template.description,
          artifactType: template.artifactType,
          tags: template.tags,
          sortOrder: template.sortOrder,
          visibility: 'GLOBAL',
          status: 'ACTIVE',
        },
      });

      if (currentHash === hash) {
        summary.unchanged += 1;
        continue;
      }

      const nextVersion = (latest?.version ?? 0) + 1;
      await tx.artifactTemplateVersion.create({
        data: {
          id: generateUuidV7(),
          templateId: existing.id,
          organizationId: null,
          createdById: null,
          version: nextVersion,
          metadata: { ...structure.metadata, fingerprint: hash },
          sections: structure.sections as Prisma.InputJsonValue,
          signatureSlots: structure.signatureSlots as Prisma.InputJsonValue,
          layout: structure.layout as Prisma.InputJsonValue,
          changeSummary: 'Atualização do catálogo oficial do Orbit',
        },
      });
      await tx.artifactTemplate.update({
        where: { id: existing.id },
        data: { currentVersion: nextVersion },
      });
      summary.versioned += 1;
    }
  });

  console.log(
    `[artifact-templates] catálogo oficial: ${summary.created} criado(s), ` +
      `${summary.versioned} nova(s) versão(ões), ${summary.unchanged} sem mudança.`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error('[artifact-templates] falha na semeadura:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
