/**
 * Monta o `RenderInput` a partir do que o banco devolveu.
 *
 * ## Por que isto saiu do processador
 *
 * A montagem — baixar evidência do storage, casar assinatura com imagem,
 * resolver o contexto do documento — vivia dentro do `try` do processador de
 * fila. Funcionava para o único caminho que existia: renderizar de verdade,
 * em segundo plano, gravando manifesto.
 *
 * O preview precisa exatamente disso e de nada do resto. Duplicar a montagem
 * garantiria que o que o owner vê e o que ele recebe divergissem na primeira
 * mudança — e divergiriam em silêncio, porque ninguém compara dois PDFs.
 *
 * Com o fabricante no meio, preview e emissão partem do **mesmo** input e do
 * mesmo renderer. A diferença entre eles é só o que acontece com os bytes.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
import { ArtifactRenderAssembler } from './artifact-render.assembler';
import { DocumentContextBuilder } from './document-context.builder';
import type { DocumentContext } from './renderers/pdf/kit/document-context';
import type { RenderInput } from './renderers/artifact-renderer';
import { PMOC_EXECUTION_LEGAL_REFERENCE } from './renderers/pdf/documents/legal';
import { readEmbeddedImage } from '../../common/embedded-image';
import { issuerLogo } from '../../common/issuer-brand';

/** A linha que o repositório devolve, com os anexos já resolvidos. */
type RenderSource = NonNullable<
  Awaited<
    ReturnType<
      import('./artifact-render.repository').ArtifactRenderRepository['findRenderSource']
    >
  >
>;

/**
 * O que o snapshot do PMOC diz sobre o contrato e a contagem.
 *
 * Leitura tolerante: `metadata` é JSON livre, e um snapshot antigo — anterior a
 * `maintenance` existir — precisa continuar imprimindo. Campo ausente vira
 * ausente, não zero: "Manutenção 0 de 12" seria pior que o campo em branco.
 */
function pmocFacts(snapshot: { artifactType: string; metadata: unknown }): {
  plan?: DocumentContext['plan'];
  maintenance?: DocumentContext['maintenance'];
} {
  if (snapshot.artifactType !== 'PMOC') return {};
  const bruto = snapshot.metadata;
  if (typeof bruto !== 'object' || bruto === null) return {};

  const dados = bruto as {
    plan?: { code?: unknown; name?: unknown };
    maintenance?: { sequence?: unknown; total?: unknown };
  };

  const numero = (valor: unknown): number | undefined =>
    typeof valor === 'number' && Number.isFinite(valor) && valor > 0
      ? valor
      : undefined;
  const texto = (valor: unknown): string | undefined =>
    typeof valor === 'string' && valor.length > 0 ? valor : undefined;

  return {
    plan: dados.plan
      ? { code: texto(dados.plan.code), name: texto(dados.plan.name) }
      : undefined,
    maintenance: dados.maintenance
      ? {
          sequence: numero(dados.maintenance.sequence),
          total: numero(dados.maintenance.total),
        }
      : undefined,
  };
}

@Injectable()
export class RenderInputFactory {
  constructor(
    private readonly assembler: ArtifactRenderAssembler,
    private readonly documentContext: DocumentContextBuilder,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async build(
    source: RenderSource,
    correlationId: string,
  ): Promise<RenderInput> {
    const evidence = await this.evidencia(source);
    const signatures = await this.assinaturas(source);
    const fieldAssets = await this.anexosDeCampo(source);

    /* O timbre vem do próprio inquilino, como data URI: da unidade emissora,
       ou da empresa quando a unidade não tem marca própria. `readEmbeddedImage`
       recusa URL — que o servidor teria de buscar — e SVG, que é documento e
       não imagem. */
    const logo = readEmbeddedImage(issuerLogo(source.businessUnit));

    /*
     * Os fatos do PMOC vêm do **snapshot**.
     *
     * O plano e a contagem de manutenção do equipamento são escritos pelo módulo
     * de PMOC nos metadados do snapshot, no momento em que o documento nasce —
     * congelados, como todo o resto dele. O builder não tem como buscá-los: ele
     * recebe a execução, e a execução não conhece o contrato.
     *
     * Sem isto o documento imprimia "Plano" e "Manutenção" em branco, porque a
     * informação existia e não era repassada.
     */
    const pmoc = pmocFacts(source.snapshot);

    const documentContext = this.documentContext.build({
      logo: logo ?? undefined,
      businessUnit: source.businessUnit,
      customer: source.customer,
      operation: source.operation,
      plan: pmoc.plan,
      maintenance: pmoc.maintenance,
      legalReference:
        source.snapshot.artifactType === 'PMOC'
          ? PMOC_EXECUTION_LEGAL_REFERENCE
          : undefined,
    });

    return source.fieldArtifact
      ? this.assembler.assembleFrozen({
          execution: source,
          snapshot: source.snapshot,
          frozen: source.fieldArtifact.snapshot,
          assets: fieldAssets,
          organizationName: source.organization.displayName,
          correlationId,
          documentContext,
        })
      : this.assembler.assemble({
          execution: source,
          snapshot: source.snapshot,
          responses: source.responses,
          signatures,
          evidence,
          organizationName: source.organization.displayName,
          correlationId,
          documentContext,
        });
  }

  private async evidencia(source: RenderSource) {
    const itens = [
      ...(source.pmocEquipmentExecution?.evidence ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        fileName: item.storageFile.fileName,
        mimeType: item.storageFile.mimeType,
        sha256: item.storageFile.sha256,
        storageFile: item.storageFile,
      })),
      ...(source.pmocEquipmentExecution?.fieldEvidence ?? []).map((item) => ({
        id: item.id,
        kind: item.category,
        caption: null,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sha256: item.sha256,
        storageFile: item.storageFile,
      })),
    ];

    return Promise.all(
      itens.map(async (item) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sha256: item.sha256,
        bytes:
          item.storageFile.status === 'AVAILABLE'
            ? await this.storage.get({
                bucket: item.storageFile.bucket,
                objectKey: item.storageFile.objectKey,
              })
            : undefined,
      })),
    );
  }

  private async assinaturas(source: RenderSource) {
    const imagens = new Map(
      await Promise.all(
        source.signatureAssets.map(
          async (asset) =>
            [
              asset.id,
              {
                bytes: await this.storage.get({
                  bucket: asset.bucket,
                  objectKey: asset.objectKey,
                }),
                mimeType: asset.mimeType,
              },
            ] as const,
        ),
      ),
    );

    return source.signatures.map((signature) => {
      const imagem = signature.signatureAssetId
        ? imagens.get(signature.signatureAssetId)
        : undefined;
      return {
        ...signature,
        signatureImage: imagem?.bytes,
        signatureImageMimeType: imagem?.mimeType,
      };
    });
  }

  private async anexosDeCampo(source: RenderSource) {
    return new Map(
      await Promise.all(
        source.fieldAssets.map(
          async (asset) =>
            [
              asset.id,
              {
                bytes: await this.storage.get({
                  bucket: asset.bucket,
                  objectKey: asset.objectKey,
                }),
                mimeType: asset.mimeType,
                fileName: asset.fileName,
              },
            ] as const,
        ),
      ),
    );
  }
}
