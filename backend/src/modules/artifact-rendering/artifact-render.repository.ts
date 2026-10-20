/**
 * Estado de renderização da execução.
 *
 * **O backend é a autoridade sobre `renderStatus`** — nenhum cliente o escreve,
 * e nenhuma rota o aceita como entrada. As transições acontecem só por aqui,
 * dentro da RLS do tenant.
 *
 * ```
 * NOT_RENDERED ──solicitar──▶ PENDING ──worker pega──▶ RENDERING
 *      ▲                                                   │
 *      │                                          ┌────────┴────────┐
 *      └──────────nova solicitação───────────  FAILED            READY
 * ```
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';

const renderSource = {
  id: true,
  organizationId: true,
  businessUnitId: true,
  code: true,
  title: true,
  status: true,
  renderStatus: true,
  renderRequestedAt: true,
  renderStartedAt: true,
  renderCompletedAt: true,
  renderError: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.ArtifactExecutionSelect;

@Injectable()
export class ArtifactRenderRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /**
   * O timbre da organização, para a amostra de um modelo.
   *
   * A amostra imprime o emitente **real** — é o que a pergunta "como o meu
   * documento vai sair" quer ver. Só o cliente e o atendimento são fictícios.
   *
   * A unidade é a **matriz** (`isPrimary`), com a mais antiga como desempate —
   * a mesma regra que os relatórios gerenciais já usavam para decidir o fuso.
   * Escolher por parâmetro acrescentaria um seletor a uma tela de demonstração.
   */
  findSampleEmitter(organizationId: string) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: { organizationId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          legalName: true,
          tradeName: true,
          documentType: true,
          documentNumber: true,
          email: true,
          phone: true,
          website: true,
          logoUrl: true,
          /* A marca da empresa, para quando a unidade não tiver a sua.
             `issuerLogo` decide; aqui só se garante que o dado chegue. */
          organization: { select: { logoUrl: true } },
          city: true,
          stateCode: true,
          district: true,
          street: true,
          number: true,
          timezone: true,
        },
      }),
    );
  }

  /** Estado atual, para responder consulta de status. */
  findState(executionId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.findFirst({
        where: { id: executionId, organizationId, deletedAt: null },
        select: renderSource,
      }),
    );
  }

  /** Tudo que a montagem da entrada precisa, em uma leitura. */
  findRenderSource(executionId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const source = await tx.artifactExecution.findFirst({
        where: { id: executionId, organizationId, deletedAt: null },
        include: {
          snapshot: true,
          responses: { orderBy: [{ sectionId: 'asc' }, { fieldId: 'asc' }] },
          signatures: { orderBy: { signedAt: 'asc' } },
          fieldArtifact: true,
          manifests: {
            where: { isActive: true, status: 'ISSUED', deletedAt: null },
            orderBy: { revision: 'desc' },
            take: 1,
          },
          pmocEquipmentExecution: {
            include: {
              evidence: {
                orderBy: { createdAt: 'asc' },
                include: { storageFile: true },
              },
              fieldEvidence: {
                where: { status: 'FINALIZED' },
                orderBy: [
                  { category: 'asc' },
                  { capturedAt: 'asc' },
                  { id: 'asc' },
                ],
                include: { storageFile: true },
              },
            },
          },
          organization: { select: { displayName: true } },

          /**
           * O contexto do documento premium.
           *
           * Timbre, cliente, atendimento e parque não são resposta de campo:
           * pedir que o técnico redigite o CNPJ da própria empresa num
           * formulário seria transformar cadastro em digitação, e o primeiro
           * erro sairia impresso com cara de verdade.
           *
           * Tudo aqui é leitura enxuta — só as colunas que o documento
           * imprime. Um `include` generoso arrastaria o parque inteiro do
           * cliente para gerar uma folha de rosto.
           */
          businessUnit: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
              email: true,
              phone: true,
              website: true,
              logoUrl: true,
              /* A marca da empresa, para quando a unidade não tiver a sua.
                 `issuerLogo` decide; aqui só se garante que o dado chegue. */
              organization: { select: { logoUrl: true } },
              city: true,
              stateCode: true,
              district: true,
              street: true,
              number: true,
              timezone: true,
            },
          },
          customer: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
            },
          },
          operation: {
            select: {
              code: true,
              title: true,
              sector: true,
              kind: true,
              priority: true,
              description: true,
              status: true,
              createdAt: true,
              scheduledEnd: true,
              authorizedAt: true,
              scheduledStart: true,
              startedAt: true,
              completedAt: true,
              responsibleFieldTechnician: { select: { displayName: true } },
              /**
               * Quem iniciou e quem concluiu.
               *
               * Uma ordem de serviço que diz apenas *quando* foi concluída não
               * responde à pergunta que o cliente faz ao contestar: por quem.
               *
               * **Só estes dois.** Acrescentar `createdBy` e `authorizedBy`
               * aqui faz o inferidor de tipos do Prisma desistir — o retorno
               * de `findRenderSource` já é grande, e com quatro relações de
               * `User` a mais ele colapsa para um tipo sem `fieldArtifact` nem
               * `manifests`, quebrando o processador. Quem criou e quem
               * autorizou têm trilha própria em `operation_history`, que é o
               * lugar certo para auditá-las.
               */
              startedBy: { select: { displayName: true } },
              completedBy: { select: { displayName: true } },
              auxiliaryTechnicians: {
                where: { removedAt: null },
                orderBy: { assignedAt: 'asc' as const },
                select: { user: { select: { displayName: true } } },
              },
              customerAddress: {
                select: {
                  label: true,
                  street: true,
                  number: true,
                  district: true,
                  city: true,
                  stateCode: true,
                  postalCode: true,
                },
              },
              assets: {
                orderBy: { createdAt: 'asc' as const },
                select: {
                  asset: {
                    select: {
                      name: true,
                      manufacturer: true,
                      model: true,
                      serialNumber: true,
                      identifier: true,
                      location: true,
                      /* A capacidade não é coluna: mora no JSON livre de
                         especificações, e o compositor lê de lá. */
                      specifications: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!source) return null;
      const signatureAssetIds = source.signatures.flatMap((signature) =>
        signature.signatureAssetId ? [signature.signatureAssetId] : [],
      );
      const signatureAssets = signatureAssetIds.length
        ? await tx.storageFile.findMany({
            where: {
              organizationId,
              id: { in: signatureAssetIds },
              status: 'AVAILABLE',
              deletedAt: null,
            },
          })
        : [];
      const frozen = this.record(source.fieldArtifact?.snapshot);
      const frozenEvidence = Array.isArray(frozen.evidence)
        ? frozen.evidence
        : [];
      const frozenSignatures = Array.isArray(frozen.signatures)
        ? frozen.signatures
        : [];
      const frozenAcknowledgement = this.record(frozen.customerAcknowledgement);
      const fieldAssetIds = [
        ...frozenEvidence.flatMap((item) => {
          const id = this.record(item).storageFileId;
          return typeof id === 'string' ? [id] : [];
        }),
        ...frozenSignatures.flatMap((item) => {
          const id = this.record(item).signatureAssetId;
          return typeof id === 'string' ? [id] : [];
        }),
        ...(typeof frozenAcknowledgement.signatureStorageFileId === 'string'
          ? [frozenAcknowledgement.signatureStorageFileId]
          : []),
      ];
      const fieldAssets = fieldAssetIds.length
        ? await tx.storageFile.findMany({
            where: {
              organizationId,
              id: { in: [...new Set(fieldAssetIds)] },
              status: 'AVAILABLE',
              deletedAt: null,
            },
          })
        : [];
      return { ...source, signatureAssets, fieldAssets };
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * `organizationId` não entra no `where`.
   *
   * O `update` do Prisma exige chave única, e a RLS já recusa a linha de outra
   * organização — o parâmetro fica na assinatura para o chamador declarar o
   * escopo, e é a política do banco que o impõe.
   */
  markPending(executionId: string, organizationId: string) {
    void organizationId;
    return this.rls.run((tx) =>
      tx.artifactExecution.update({
        where: { id: executionId },
        data: {
          renderStatus: 'PENDING',
          renderRequestedAt: new Date(),
          renderStartedAt: null,
          renderCompletedAt: null,
          renderError: null,
        },
        select: renderSource,
      }),
    );
  }

  markRendering(executionId: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.update({
        where: { id: executionId },
        data: { renderStatus: 'RENDERING', renderStartedAt: new Date() },
        select: renderSource,
      }),
    );
  }

  markReady(executionId: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.update({
        where: { id: executionId },
        data: {
          renderStatus: 'READY',
          renderCompletedAt: new Date(),
          renderError: null,
        },
        select: renderSource,
      }),
    );
  }

  /**
   * Falha.
   *
   * `reason` é mensagem de negócio, truncada — nunca stack, caminho de arquivo
   * ou credencial. O detalhe técnico fica no log, com o mesmo `correlationId`.
   */
  markFailed(executionId: string, reason: string) {
    return this.rls.run((tx) =>
      tx.artifactExecution.update({
        where: { id: executionId },
        data: {
          renderStatus: 'FAILED',
          renderCompletedAt: new Date(),
          renderError: reason.slice(0, 500),
        },
        select: renderSource,
      }),
    );
  }

  /** Auditoria da solicitação e do desfecho. */
  audit(
    organizationId: string,
    businessUnitId: string,
    actorId: string | null,
    action: string,
    executionId: string,
    after: Prisma.InputJsonValue,
  ) {
    return this.rls.run((tx) =>
      tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId,
          userId: actorId,
          action,
          entityType: 'ARTIFACT_EXECUTION',
          entityId: executionId,
          after,
        },
      }),
    );
  }
}
