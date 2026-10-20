/**
 * Regras do domínio PMOC.
 *
 * ## O plano não é o documento
 *
 * Um `PmocPlan` existe, vale e vence sem que nenhum PDF tenha sido emitido. O
 * documento é **evidência** de um ciclo cumprido, e é vinculado quando existe
 * de verdade — nunca fabricado para "ter documento".
 *
 * ## O que este serviço não decide
 *
 * Não interpreta norma, não escolhe periodicidade por tipo de equipamento e não
 * emite parecer de conformidade legal. A periodicidade é a contratada; o Orbit
 * a cumpre, mede e registra.
 *
 * ## Autorização não atravessa domínios
 *
 * `pmoc.manage` cria plano e cobertura. **Não** cria ordem de serviço sozinha:
 * gerar a operação de um ciclo exige também `operations.manage`, e vincular a
 * evidência exige `artifact_executions.read`. Um domínio que integra outros é
 * exatamente onde as autorizações se perdem, se cada uma não for conferida no
 * seu lugar.
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { HashHelper } from '../../helpers';
import {
  MOTIVO_DO_ESTADO,
  validadeDoLink,
  type EstadoDoLink,
} from './pmoc-signature-link';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES } from '../jobs/background-job.types';
import { Prisma } from '@prisma/client';
import { generateUuidV7 } from '../../utils';
import {
  canTransition,
  coverageEndFromDuration,
  isValidPlanCode,
  normalizeCustomCode,
  EDITABLE_STATUSES,
  evaluateCompliance,
  executionEligibility,
  frequencyLabel,
  previewSchedule,
  toDateOnly,
  type FrequencyUnit,
  type PlanStatus,
} from './pmoc.domain';
import type {
  AddPmocCoverageDto,
  AddPmocEquipmentEvidenceDto,
  CompletePmocEquipmentExecutionDto,
  GeneratePmocEquipmentArtifactDto,
  CompletePmocExecutionDto,
  CreatePmocOperationDto,
  CreatePmocPlanDto,
  CreatePmocUnitDto,
  PreviewPmocPlanDto,
  LinkPmocEvidenceDto,
  PmocAnalyticsQueryDto,
  PmocPlanQueryDto,
  PmocCoveragePageQueryDto,
  PmocTimelineQueryDto,
  PmocUpcomingQueryDto,
  StartPmocEquipmentExecutionDto,
  UpdatePmocPlanDto,
  UpdatePmocUnitDto,
} from './pmoc.dto';
import { PmocMapper } from './pmoc.mapper';
import type {
  PmocComplianceSummaryReadModel,
  PmocUpcomingReadModel,
  PmocCursorPageReadModel,
  PmocCoverageReadModel,
  PmocTimelineItemReadModel,
} from './pmoc.read-models';
import { instantFromCivilDate } from '../scheduling/scheduling-time';
import { PmocRepository } from './pmoc.repository';
import { WorkforceService } from '../workforce/workforce.service';
import { ArtifactRenderService } from '../artifact-rendering/artifact-render.service';
import { PmocPlanDocumentService } from '../artifact-rendering/pmoc-plan-document.service';
import { PMOC_PLAN_LEGAL_REFERENCE } from '../artifact-rendering/renderers/pdf/documents/legal';
import { readEmbeddedImage } from '../../common/embedded-image';
import { issuerLogo, type BrandedIssuer } from '../../common/issuer-brand';

/** Quem pediu, e o que ele pode. */
export interface PmocActor {
  organizationId: string;
  actorId: string;
  permissions: readonly string[];
  businessUnitIds: readonly string[];
  /**
   * O dono da organização atende qualquer execução, atribuída a quem for.
   *
   * Não é o mesmo que ter `pmoc.manage`: essa permissão diz que a pessoa
   * administra o módulo — cria plano, cobre equipamento, encerra contrato. Quem
   * **executa** a manutenção de um aparelho é quem foi escalado para ela, e o
   * dono, que responde pela operação quando ninguém mais pode.
   */
  isOrganizationOwner: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/* -------------------------------------------------------------------- */
/* Formatação do documento do plano                                      */
/* -------------------------------------------------------------------- */

/** `2026-03-01` ou um `Date` viram `01/03/2026`. */
function dataSimples(valor: Date | string | null | undefined) {
  if (!valor) return undefined;
  const texto = typeof valor === 'string' ? valor : valor.toISOString();
  const [ano, mes, dia] = texto.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : undefined;
}

/**
 * O timbre do emissor, quando há e quando é seguro imprimir.
 *
 * `issuerLogo` escolhe entre a marca da unidade e a da empresa;
 * `readEmbeddedImage` recusa URL — que o servidor teria de buscar, e o endereço
 * é escolhido pelo inquilino — e SVG, que carrega script.
 */
function logoDoEmissor(emissor: BrandedIssuer | null | undefined) {
  const imagem = readEmbeddedImage(issuerLogo(emissor));
  return imagem
    ? { logo: imagem.bytes, logoMimeType: imagem.mimeType }
    : undefined;
}

/** CNPJ e CPF com máscara. Qualquer outro tipo sai como veio. */
function documentoFormatado(
  tipo: string | null | undefined,
  numero: string | null | undefined,
) {
  if (!numero) return undefined;
  const digitos = numero.replace(/\D/g, '');
  if (tipo === 'CNPJ' && digitos.length === 14) {
    const mascarado = digitos.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
    return `CNPJ ${mascarado}`;
  }
  if (tipo === 'CPF' && digitos.length === 11) {
    const mascarado = digitos.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      '$1.$2.$3-$4',
    );
    return `CPF ${mascarado}`;
  }
  return tipo ? `${tipo} ${numero}` : numero;
}

function enderecoDaUnidade(
  unidade: {
    street?: string | null;
    number?: string | null;
    district?: string | null;
  } | null,
) {
  if (!unidade) return undefined;
  const logradouro = [unidade.street, unidade.number]
    .filter(Boolean)
    .join(', ');
  const partes = [logradouro, unidade.district].filter(
    (parte) => parte && parte.length > 0,
  );
  return partes.length > 0 ? partes.join(' — ') : undefined;
}

function cidadeUf(
  unidade: { city?: string | null; stateCode?: string | null } | null,
) {
  const partes = [unidade?.city, unidade?.stateCode].filter(Boolean);
  return partes.length > 0 ? partes.join('/') : undefined;
}

/** `serviceTypes` é JSONB livre no banco; só imprimimos o que for texto. */
function listaDeTextos(valor: unknown): readonly string[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const textos = valor
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return textos.length > 0 ? textos : undefined;
}

/**
 * A capacidade não tem coluna: fica em `Asset.specifications`, que é JSON livre
 * porque cada organização nomeia o campo do seu jeito. Procuramos as chaves
 * que aparecem de fato em vez de exigir um esquema que ninguém adotou.
 */
function capacidadeDeclarada(specifications: unknown) {
  if (!specifications || typeof specifications !== 'object') return undefined;
  const registro = specifications as Record<string, unknown>;
  for (const [chave, valor] of Object.entries(registro)) {
    if (!/capacidade|capacity|btu|btus|tr/i.test(chave)) continue;
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
    if (typeof valor === 'number') return String(valor);
  }
  return undefined;
}

/**
 * O roteiro previsto vive em `PmocPlan.procedure`, um JSON livre. Aceitamos as
 * duas formas que o produto gera hoje — grupo com lista de textos e grupo com
 * lista de objetos rotulados — e ignoramos o que não souber ler, porque um
 * roteiro parcial impresso é melhor que uma emissão que falha.
 */
function roteiroDoPlano(procedure: unknown) {
  if (!procedure || typeof procedure !== 'object') return [];
  const grupos: { group: string; items: string[] }[] = [];

  for (const [grupo, valor] of Object.entries(
    procedure as Record<string, unknown>,
  )) {
    const itens = itensDoGrupo(valor);
    if (itens.length > 0) grupos.push({ group: grupo, items: itens });
  }

  return grupos;
}

function itensDoGrupo(valor: unknown): string[] {
  if (typeof valor === 'string') return valor.trim() ? [valor.trim()] : [];
  if (!Array.isArray(valor)) return [];

  return valor
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const registro = item as Record<string, unknown>;
        const rotulo =
          registro.label ?? registro.name ?? registro.title ?? registro.text;
        return typeof rotulo === 'string' ? rotulo.trim() : '';
      }
      return '';
    })
    .filter((item) => item.length > 0);
}

@Injectable()
export class PmocService {
  constructor(
    private readonly repository: PmocRepository,
    private readonly mapper: PmocMapper,
    private readonly jobs: BackgroundJobQueue,
    private readonly workforce: WorkforceService,
    private readonly rendering: ArtifactRenderService,
    private readonly planDocument: PmocPlanDocumentService,
    /* Para ler os bytes da assinatura do Responsável Técnico ao imprimir o
       contrato — a mesma dependência que o orçamento usa, pelo mesmo motivo. */
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Link de assinatura do contrato                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Gera o link para o contratante ler e assinar o contrato.
   *
   * ## O segredo existe uma vez
   *
   * O banco guarda só o SHA-256. O token em claro volta nesta resposta e nunca mais:
   * é por isso que a tela mostra o endereço para copiar em vez de oferecer "ver o
   * link de novo" — oferecer isso exigiria guardar o segredo, que é exatamente o que
   * não se faz.
   *
   * ## Gerar um revoga o anterior
   *
   * Pedido do produto, e a razão é de segurança: um link antigo circulando por
   * e-mail continuaria abrindo o contrato depois de o dono ter decidido gerar outro.
   * A revogação e a criação estão na mesma transação, e o índice parcial é o que
   * garante a regra quando duas telas pedem link ao mesmo tempo.
   *
   * Links já assinados não são tocados: são a prova do que o contratante assinou.
   */
  async createSignatureLink(id: string, actor: PmocActor) {
    const plan = await this.plan(id, actor);
    if (plan._count.coverages === 0) {
      throw new ConflictException(
        'A PMOC plan needs at least one covered equipment before it can be signed',
      );
    }

    const token = randomBytes(48).toString('base64url');
    const link = await this.repository.createSignatureLink({
      organizationId: actor.organizationId,
      planId: plan.id,
      tokenHash: HashHelper.sha256(token),
      expiresAt: validadeDoLink(),
      createdById: actor.actorId,
    });

    return {
      token,
      expiresAt: link.expiresAt.toISOString(),
      planCode: plan.code,
    };
  }

  /**
   * O contrato que o token abre, para a página pública.
   *
   * Token inexistente e token recusado respondem diferente de propósito: inexistente
   * é 404 — não há contrato nenhum ali —, e recusado é o contrato existindo com um
   * motivo que a página mostra. "Link inválido" para os dois mandaria o contratante
   * perguntar ao dono o que ele mesmo podia ler na tela.
   */
  async publicContract(token: string) {
    const linha = await this.repository.signatureLinkByToken(
      HashHelper.sha256(token),
    );
    if (!linha) throw new EntityNotFoundException('PmocContract');

    const estado = linha.state as EstadoDoLink;
    return {
      state: estado,
      reason: MOTIVO_DO_ESTADO[estado] || null,
      plan: {
        code: linha.plan_code,
        name: linha.plan_name,
        startsOn: toDateOnly(linha.starts_on),
        endsOn: linha.ends_on ? toDateOnly(linha.ends_on) : null,
        frequency: frequencyLabel({
          amount: linha.frequency_amount,
          unit: linha.frequency_unit as FrequencyUnit,
        }),
        coveredEquipment: linha.covered_equipment,
        technicalResponsible: linha.technical_responsible,
      },
      customer: { name: linha.customer_name },
      emitter: { name: linha.emitter_name },
      signature: linha.signed_at
        ? {
            signerName: linha.signer_name,
            signedAt: linha.signed_at.toISOString(),
          }
        : null,
      expiresAt: linha.expires_at.toISOString(),
    };
  }

  /**
   * Registra a assinatura do contratante.
   *
   * ## O arquivo sobe antes de ser registrado
   *
   * Primeiro o objeto vai para o bucket, depois a função grava a linha. Registrar
   * antes de subir deixaria o contrato apontando para um objeto que não existe — e
   * essa é a falha que ninguém percebe até o fiscal pedir o papel.
   *
   * A ordem inversa tem o próprio custo: subindo e falhando o registro, sobra um
   * objeto órfão no bucket. É o lado certo de errar — bytes sem referência custam
   * armazenamento; referência sem bytes custa o documento.
   *
   * ## A recusa não é erro
   *
   * Link expirado, substituído ou já assinado devolvem o estado, e a página mostra a
   * frase. Lançar exceção para "já assinado" transformaria o fim feliz em falha.
   */
  async signPublicContract(
    token: string,
    input: {
      signerName: string;
      signerDocument?: string;
      signerEmail?: string;
      signature: Buffer;
      mimeType: string;
      ip?: string;
      userAgent?: string;
    },
  ) {
    const tokenHash = HashHelper.sha256(token);
    const linha = await this.repository.signatureLinkByToken(tokenHash);
    if (!linha) throw new EntityNotFoundException('PmocContract');

    const estadoAtual = linha.state as EstadoDoLink;
    if (estadoAtual !== 'VALIDO') {
      return { state: estadoAtual, reason: MOTIVO_DO_ESTADO[estadoAtual] };
    }

    const sha256 = createHash('sha256').update(input.signature).digest('hex');
    /* A chave carrega o hash do token, e não o id do plano: ela não pode revelar
       qual contrato é, porque o bucket é compartilhado pela organização. */
    const objectKey = `pmoc-contract-signatures/${tokenHash}.png`;
    const bucket = this.storage.defaultBucket;

    await this.storage.put({
      bucket,
      objectKey,
      body: input.signature,
      mimeType: input.mimeType,
      metadata: { source: 'PMOC_CONTRACT_SIGNATURE' },
    });

    const resultado = await this.repository.signByToken({
      tokenHash,
      signerName: input.signerName,
      signerDocument: input.signerDocument,
      signerEmail: input.signerEmail,
      ip: input.ip,
      userAgent: input.userAgent,
      bucket,
      objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.signature.byteLength,
      sha256,
    });

    /**
     * `INEXISTENTE` é 404, e não uma recusa com motivo nulo.
     *
     * A função devolve esse estado quando a linha sumiu entre a leitura e o `FOR
     * UPDATE`, ou quando o plano foi removido nesse intervalo. Não é um dos estados
     * de link — não há frase para ele em `MOTIVO_DO_ESTADO` —, e deixá-lo cair no
     * `?? null` produzia `{ reason: null }`, que é **o sinal de sucesso**: a página
     * diria "contrato assinado" sem nada ter sido gravado.
     */
    if (resultado.state === 'INEXISTENTE') {
      throw new EntityNotFoundException('PmocContract');
    }

    const estado = resultado.state as EstadoDoLink;
    return {
      state: estado,
      reason: resultado.signed ? null : MOTIVO_DO_ESTADO[estado],
    };
  }

  /**
   * A assinatura que o contratante deixou pelo link público.
   *
   * A mais recente, quando há mais de uma: gerar um link novo depois de uma
   * assinatura é refazer o aceite, e o contrato imprime o último.
   *
   * Falha ao ler não derruba a emissão, pela mesma razão da assinatura do
   * responsável: o contrato é o papel que o fiscal pede, e não pode deixar de existir
   * por causa de um arquivo de imagem.
   */
  private async contratanteAssinatura(
    planId: string,
    organizationId: string,
    timezone: string,
  ): Promise<{
    bytes?: Buffer;
    mimeType?: string;
    signerName?: string;
    signedAtLabel?: string;
  }> {
    const coletada = await this.repository.latestSignature(
      planId,
      organizationId,
    );
    if (!coletada?.signatureFile || !coletada.signerName) return {};

    const assinadoEm = coletada.signedAt
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(coletada.signedAt)
      : undefined;

    try {
      return {
        bytes: await this.storage.get({
          bucket: coletada.signatureFile.bucket,
          objectKey: coletada.signatureFile.objectKey,
        }),
        mimeType: coletada.signatureFile.mimeType,
        signerName: coletada.signerName,
        signedAtLabel: assinadoEm ? `Assinado em ${assinadoEm}` : undefined,
      };
    } catch {
      /* Sem os bytes, ainda vale dizer quem assinou e quando: é informação que o
         documento tem e que a linha em branco perderia. */
      return {
        signerName: coletada.signerName,
        signedAtLabel: assinadoEm ? `Assinado em ${assinadoEm}` : undefined,
      };
    }
  }

  /**
   * A assinatura ativa do Responsável Técnico, para o contrato.
   *
   * ## Por que a falha não derruba o documento
   *
   * O objeto pode estar inacessível — bucket fora do ar, chave apagada à mão. O
   * contrato do PMOC é o papel que o fiscal pede na porta, e não pode deixar de
   * existir por causa de um arquivo de imagem: sai com a linha em branco, que é o
   * mesmo resultado de quem nunca cadastrou assinatura.
   */
  private async responsavelTecnicoAssinatura(
    responsible:
      | {
          professionalSignatures: readonly {
            storageObject: {
              bucket: string;
              objectKey: string;
              mimeType: string;
            };
          }[];
        }
      | null
      | undefined,
  ): Promise<{ bytes?: Buffer; mimeType?: string }> {
    const assinatura = responsible?.professionalSignatures[0];
    if (!assinatura) return {};
    try {
      return {
        bytes: await this.storage.get({
          bucket: assinatura.storageObject.bucket,
          objectKey: assinatura.storageObject.objectKey,
        }),
        mimeType: assinatura.storageObject.mimeType,
      };
    } catch {
      return {};
    }
  }

  /* ---------------------------------------------------------------- */
  /* Planos                                                            */
  /* ---------------------------------------------------------------- */

  async create(actor: PmocActor, input: CreatePmocPlanDto) {
    const unit = await this.repository.findBusinessUnit(
      input.businessUnitId,
      actor.organizationId,
    );
    if (!unit) {
      throw new EntityNotFoundException('BusinessUnit', input.businessUnitId);
    }
    this.assertUnitInScope(actor, input.businessUnitId);

    const customer = await this.repository.findCustomer(
      input.customerId,
      actor.organizationId,
    );
    if (!customer) {
      throw new EntityNotFoundException('Customer', input.customerId);
    }

    if (input.technicianUserId) {
      const member = await this.repository.findMember(
        input.technicianUserId,
        actor.organizationId,
      );
      if (!member) {
        throw new ValidationException(
          'The technician must be an active member of this organization',
        );
      }
    }
    if (input.technicalResponsibleUserId) {
      await this.assertTechnicalResponsible(
        input.technicalResponsibleUserId,
        actor,
        input.businessUnitId,
      );
    }

    this.assertValidity(input.startsOn, input.endsOn ?? null);

    /**
     * Código customizado é validado; código ausente é gerado.
     *
     * A checagem antes do insert é cortesia — quem decide é a constraint
     * parcial `pmoc_plans_code_unique_active`, e o `catch` abaixo transforma a
     * violação em conflito público. Confiar só no `planCodeTaken` seria
     * verificar-e-agir, que duas requisições simultâneas atravessam juntas.
     */
    const code = input.code ? normalizeCustomCode(input.code) : null;
    if (code) {
      if (!isValidPlanCode(code)) {
        throw new ValidationException(
          'The plan code accepts letters, digits and . _ / - only',
        );
      }
      if (await this.repository.planCodeTaken(actor.organizationId, code)) {
        throw new ConflictException(
          `A PMOC plan with code "${code}" already exists`,
        );
      }
    }

    /**
     * Os equipamentos são revalidados aqui, não na tela.
     *
     * O seletor já mostra só o que é do cliente, mas quem monta o corpo da
     * requisição é quem quiser. Um `assetId` de outro cliente entraria como
     * cobertura, e a partir daí o PMOC de um cliente mandaria o técnico ao
     * equipamento de outro.
     */
    const assetIds: string[] = [...new Set(input.assetIds ?? [])];
    if (assetIds.length) {
      const elegiveis = await this.repository.findEligibleAssets({
        organizationId: actor.organizationId,
        customerId: input.customerId,
        assetIds,
      });
      if (elegiveis.length !== assetIds.length) {
        throw new ValidationException(
          'Every equipment must belong to the selected customer',
        );
      }
    }

    /**
     * E as unidades também.
     *
     * A RLS de `pmoc_plan_units` só garante que o **plano** é desta
     * organização: a tabela de vínculo não tem coluna de inquilino, e a FK para
     * `pmoc_units` não conhece organização. Sem esta checagem um `unitId` de
     * outro inquilino era aceito — verificado ao vivo, 201 — e o plano passava a
     * declarar o atendimento de uma unidade que ninguém desta conta pode ler,
     * que é exatamente o que o relatório iria imprimir.
     *
     * Unidade inativa também não entra: declarar atendimento de uma unidade
     * tirada de circulação seria prometer serviço que o catálogo já aposentou.
     */
    const unitIds: string[] = [...new Set(input.unitIds ?? [])];
    if (unitIds.length) {
      const elegiveis = await this.repository.findEligibleUnits(
        actor.organizationId,
        unitIds,
      );
      if (elegiveis.length !== unitIds.length) {
        throw new ValidationException(
          'Every unit must be an active unit of this organization',
        );
      }
    }

    const plan = await this.createPlan(
      actor,
      input,
      code,
      assetIds,
      unitIds,
      customer,
    );
    return this.mapper.summary(plan);
  }

  /** O insert em si, com a violação de unicidade virando conflito público. */
  private async createPlan(
    actor: PmocActor,
    input: CreatePmocPlanDto,
    code: string | null,
    assetIds: string[],
    unitIds: string[],
    customer: { legalName: string },
  ) {
    try {
      return await this.repository.create(
        {
          assetIds,
          /// Já sem duplicatas e já conferidas — veja `create`.
          unitIds,
          organizationId: actor.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          code,
          customerName: customer.legalName,
          name: input.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn ?? null,
          frequencyAmount: input.frequencyAmount,
          frequencyUnit: input.frequencyUnit,
          dueSoonDays: input.dueSoonDays ?? 15,
          technicianUserId: input.technicianUserId ?? null,
          technicalResponsibleUserId: input.technicalResponsibleUserId ?? null,
          serviceLocation: input.serviceLocation as never,
          scope: input.scope as never,
          serviceTypes: input.serviceTypes ?? [],
          procedure: (input.procedure ?? {}) as never,
          schedulingPaused: input.schedulingPaused ?? false,
          reviewRequired: input.reviewRequired ?? false,
          notes: input.notes ?? null,
          createdById: actor.actorId,
        },
        actor.actorId,
      );
    } catch (error) {
      /**
       * P2002 é a constraint de código, e ela existe justamente para o caso
       * que a checagem anterior não pega: duas requisições simultâneas com o
       * mesmo código customizado. Deixar subir daria 500 — um erro técnico
       * numa situação que o produto sabe explicar.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A PMOC plan with code "${code ?? input.code}" already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * O código que a tela preenche sozinha ao escolher o cliente.
   *
   * Só **lê** o próximo número: uma tela aberta e abandonada não pode queimar
   * `007` para sempre. Quem consome de verdade é o create, e é lá que a
   * reserva acontece de forma atômica. O efeito é que dois usuários abrindo o
   * formulário ao mesmo tempo veem o mesmo `003` — e o segundo a salvar
   * recebe `004` sem erro nenhum, porque o create realoca.
   */
  /* ---------------------------------------------------------------- */
  /* Unidades                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * As unidades da organização — condensadora, evaporadora, dutos.
   *
   * Cada uma traz o roteiro vinculado, porque é o que a tela precisa mostrar
   * para quem escolhe: uma unidade sem checklist entra no plano e não
   * descreve serviço nenhum, e isso tem de ser visível na hora de marcar.
   */
  async listUnits(actor: PmocActor, onlyActive = true) {
    const rows = await this.repository.listUnits(
      actor.organizationId,
      onlyActive,
    );
    return rows.map((row) => this.mapper.unitEntry(row));
  }

  async createUnit(actor: PmocActor, input: CreatePmocUnitDto) {
    await this.requireChecklist(actor, input.checklistTemplateId);
    const created = await this.repository.createUnit({
      organizationId: actor.organizationId,
      key: input.key.toUpperCase(),
      name: input.name,
      description: input.description,
      checklistTemplateId: input.checklistTemplateId,
      sortOrder: input.sortOrder,
    });
    return this.mapper.unitEntry(created);
  }

  async updateUnit(actor: PmocActor, id: string, input: UpdatePmocUnitDto) {
    const current = await this.repository.findUnit(id, actor.organizationId);
    if (!current) throw new EntityNotFoundException('PmocUnit', id);
    await this.requireChecklist(actor, input.checklistTemplateId);
    const updated = await this.repository.updateUnit(id, {
      name: input.name,
      description: input.description,
      checklistTemplateId: input.checklistTemplateId,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    });
    return this.mapper.unitEntry(updated);
  }

  async removeUnit(actor: PmocActor, id: string) {
    const current = await this.repository.findUnit(id, actor.organizationId);
    if (!current) throw new EntityNotFoundException('PmocUnit', id);
    await this.repository.softDeleteUnit(id);
  }

  /**
   * O checklist informado existe nesta organização?
   *
   * Sem esta checagem, um id de outro inquilino seria aceito pelo banco (a
   * FK não conhece organização) e a unidade nasceria apontando para um
   * roteiro que ninguém desta conta pode ler.
   */
  private async requireChecklist(actor: PmocActor, templateId?: string) {
    if (!templateId) return;
    const template = await this.repository.findChecklistTemplate(
      templateId,
      actor.organizationId,
    );
    if (!template)
      throw new EntityNotFoundException('ChecklistTemplate', templateId);
  }

  /**
   * Os nomes sugeridos, ativos, na ordem do catálogo.
   *
   * Não recebe ator: o catálogo é da plataforma e não varia por organização.
   */
  planNameOptions() {
    return this.repository.planNameOptions();
  }

  async codeSuggestion(actor: PmocActor, customerId: string) {
    const customer = await this.repository.findCustomer(
      customerId,
      actor.organizationId,
    );
    if (!customer) throw new EntityNotFoundException('Customer', customerId);

    const { code, sequence } = await this.repository.allocateCode({
      organizationId: actor.organizationId,
      customerId,
      customerName: customer.legalName,
      reserve: false,
    });

    return {
      customerId,
      customerName: customer.legalName,
      suggestedCode: code,
      sequence,
      reserved: false,
    };
  }

  /**
   * O que este plano vai gerar, antes de existir.
   *
   * ## Por que o backend responde isto
   *
   * Os ciclos do PMOC são rolantes: ativar cria o primeiro, e cada conclusão
   * cria o seguinte a partir da data real do serviço. É o desenho certo — a
   * próxima manutenção conta a partir da última que aconteceu, não de um
   * calendário que ninguém cumpriu.
   *
   * O preço é que nada respondia *"quantas visitas este contrato terá"* antes
   * da primeira. Esta projeção responde, sem escrever nada: é o calendário
   * ideal, e a matriz equipamento × execução que sai dele.
   *
   * Deixar a tela multiplicar `ciclos × equipamentos` seria mais barato e
   * estaria errado na primeira regra de calendário — a saturação de fim de mês
   * mora aqui e no banco, não em JavaScript de formulário.
   */
  async preview(actor: PmocActor, input: PreviewPmocPlanDto) {
    const unit = await this.repository.findBusinessUnit(
      input.businessUnitId,
      actor.organizationId,
    );
    if (!unit) {
      throw new EntityNotFoundException('BusinessUnit', input.businessUnitId);
    }
    this.assertUnitInScope(actor, input.businessUnitId);

    const customer = await this.repository.findCustomer(
      input.customerId,
      actor.organizationId,
    );
    if (!customer) {
      throw new EntityNotFoundException('Customer', input.customerId);
    }

    /** A vigência chega como duração ou como data — nunca como as duas. */
    const endsOn =
      input.coverageAmount != null
        ? coverageEndFromDuration(
            input.startsOn,
            input.coverageAmount,
            input.coverageUnit ?? 'MONTHS',
          )
        : (input.endsOn ?? null);

    this.assertValidity(input.startsOn, endsOn);

    const assetIds: string[] = [...new Set(input.assetIds ?? [])];
    const equipamentos = assetIds.length
      ? await this.repository.findEligibleAssets({
          organizationId: actor.organizationId,
          customerId: input.customerId,
          assetIds,
        })
      : [];
    if (equipamentos.length !== assetIds.length) {
      throw new ValidationException(
        'Every equipment must belong to the selected customer',
      );
    }

    const schedule = previewSchedule({
      startsOn: input.startsOn,
      endsOn,
      frequencyAmount: input.frequencyAmount,
      frequencyUnit: input.frequencyUnit,
    });

    return {
      customer: { id: customer.id, name: customer.legalName },
      timezone: unit.timezone,
      startsOn: input.startsOn,
      endsOn,
      frequency: {
        amount: input.frequencyAmount,
        unit: input.frequencyUnit,
        label: frequencyLabel({
          amount: input.frequencyAmount,
          unit: input.frequencyUnit,
        }),
      },
      cycles: schedule.cycles,
      cycleCount: schedule.cycles.length,
      truncated: schedule.truncated,
      equipmentCount: equipamentos.length,

      /**
       * A matriz. Cada equipamento recebe a mesma sequência `1..N`, porque
       * cada equipamento participa de cada ciclo — não é uma numeração global
       * intercalada entre eles.
       */
      matrix: equipamentos.map((asset) => ({
        equipment: {
          id: asset.id,
          name: asset.name,
          model: asset.model,
          manufacturer: asset.manufacturer,
          status: asset.status,
        },
        executions: schedule.cycles.map((cycle) => ({
          executionNumber: cycle.sequence,
          dueOn: cycle.dueOn,
        })),
      })),
      projectedExecutions: schedule.cycles.length * equipamentos.length,
    };
  }

  async update(id: string, actor: PmocActor, input: UpdatePmocPlanDto) {
    const plan = await this.plan(id, actor);

    if (!EDITABLE_STATUSES.includes(plan.status)) {
      throw new ConflictException(
        `A ${plan.status.toLowerCase()} plan cannot be edited`,
      );
    }

    const startsOn = input.startsOn ?? toDateOnly(plan.startsOn);
    const endsOn =
      input.endsOn ?? (plan.endsOn ? toDateOnly(plan.endsOn) : null);
    this.assertValidity(startsOn, endsOn ?? null);

    if (input.technicianUserId) {
      const member = await this.repository.findMember(
        input.technicianUserId,
        actor.organizationId,
      );
      if (!member) {
        throw new ValidationException(
          'The technician must be an active member of this organization',
        );
      }
    }
    if (input.technicalResponsibleUserId) {
      await this.assertTechnicalResponsible(
        input.technicalResponsibleUserId,
        actor,
        plan.businessUnit.id,
      );
    }

    const updated = await this.repository.update(
      id,
      actor.organizationId,
      actor.actorId,
      {
        ...(input.name ? { name: input.name } : {}),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.startsOn
          ? { startsOn: new Date(`${input.startsOn}T00:00:00.000Z`) }
          : {}),
        ...(input.endsOn
          ? { endsOn: new Date(`${input.endsOn}T00:00:00.000Z`) }
          : {}),
        ...(input.frequencyAmount
          ? { frequencyAmount: input.frequencyAmount }
          : {}),
        ...(input.frequencyUnit ? { frequencyUnit: input.frequencyUnit } : {}),
        ...(input.dueSoonDays ? { dueSoonDays: input.dueSoonDays } : {}),
        ...(input.technicianUserId
          ? { technician: { connect: { id: input.technicianUserId } } }
          : {}),
        ...(input.technicalResponsibleUserId
          ? {
              technicalResponsible: {
                connect: { id: input.technicalResponsibleUserId },
              },
            }
          : {}),
        ...(input.serviceLocation === undefined
          ? {}
          : { serviceLocation: input.serviceLocation as never }),
        ...(input.scope === undefined ? {} : { scope: input.scope as never }),
        ...(input.serviceTypes === undefined
          ? {}
          : { serviceTypes: input.serviceTypes }),
        ...(input.procedure === undefined
          ? {}
          : { procedure: input.procedure as never }),
        ...(input.schedulingPaused === undefined
          ? {}
          : { schedulingPaused: input.schedulingPaused }),
        ...(input.reviewRequired === undefined
          ? {}
          : { reviewRequired: input.reviewRequired }),
      },
      'PMOC_PLAN_UPDATED',
      { name: plan.name, status: plan.status },
    );

    return this.mapper.summary(updated);
  }

  list(actor: PmocActor, query: PmocPlanQueryDto) {
    return this.repository.list(actor.organizationId, query).then((result) => ({
      data: result.data.map((plan) => this.mapper.summary(plan)),
      meta: result.meta,
    }));
  }

  /**
   * O documento do plano — o papel que o fiscal pede na porta.
   *
   * Não passa pela fila de renderização porque não é uma execução: não há
   * snapshot congelado, respostas de campo nem revisão. É a configuração
   * **de agora**, impressa agora. Cada emissão redesenha do banco, e por isso
   * carrega a data de emissão com destaque.
   */
  async document(id: string, actor: PmocActor) {
    const source = await this.repository.documentSource(
      id,
      actor.organizationId,
    );
    if (!source) throw new EntityNotFoundException('PmocPlan', id);

    const { plan, coverages, planUnits } = source;
    const fuso = plan.businessUnit?.timezone ?? 'America/Sao_Paulo';
    const assinaturaDoResponsavel = await this.responsavelTecnicoAssinatura(
      plan.technicalResponsible,
    );
    const assinaturaDoContratante = await this.contratanteAssinatura(
      id,
      actor.organizationId,
      fuso,
    );

    const bytes = await this.planDocument.render({
      timezone: fuso,
      emitter: {
        ...logoDoEmissor(plan.businessUnit),
        tradeName: plan.businessUnit?.tradeName ?? undefined,
        legalName: plan.businessUnit?.legalName ?? undefined,
        document: documentoFormatado(
          plan.businessUnit?.documentType,
          plan.businessUnit?.documentNumber,
        ),
        address: enderecoDaUnidade(plan.businessUnit),
        cityState: cidadeUf(plan.businessUnit),
        phone: plan.businessUnit?.phone ?? undefined,
        email: plan.businessUnit?.email ?? undefined,
        website: plan.businessUnit?.website ?? undefined,
      },
      plan: {
        plan: {
          code: plan.code,
          name: plan.name,
          status: plan.status,
          coverageStart: dataSimples(plan.startsOn),
          coverageEnd: dataSimples(plan.endsOn),
          cadence: frequencyLabel({
            amount: plan.frequencyAmount,
            // `frequency_unit` é VARCHAR no banco, não enum: o cast é a mesma
            // convenção do mapper, e `frequencyLabel` já tem queda para
            // "período" se algum dia chegar um valor fora da lista.
            unit: plan.frequencyUnit as FrequencyUnit,
          }),
          serviceTypes: listaDeTextos(plan.serviceTypes),
          notes: plan.notes ?? undefined,
          technicalResponsible:
            plan.technicalResponsible?.displayName ?? undefined,
          technicalResponsibleSignature: assinaturaDoResponsavel.bytes,
          technicalResponsibleSignatureMimeType:
            assinaturaDoResponsavel.mimeType,
          fieldTechnician: plan.technician?.displayName ?? undefined,
          nextDueOn: dataSimples(plan.nextDueOn),
          lastExecutedAt: dataSimples(plan.lastExecutedAt),
        },
        customer: {
          name: plan.customer?.tradeName ?? plan.customer?.legalName,
          document: documentoFormatado(
            plan.customer?.documentType,
            plan.customer?.documentNumber,
          ),
          /* A assinatura coletada pelo link público, quando houve uma. Sem ela a
             linha sai em branco para assinar à mão, como sempre funcionou. */
          signature: assinaturaDoContratante.bytes,
          signatureMimeType: assinaturaDoContratante.mimeType,
          signedBy: assinaturaDoContratante.signerName,
          signedAtLabel: assinaturaDoContratante.signedAtLabel,
        },
        equipment: coverages.map((coverage) => ({
          name: coverage.asset?.name ?? undefined,
          manufacturer: coverage.asset?.manufacturer ?? undefined,
          model: coverage.asset?.model ?? undefined,
          capacity: capacidadeDeclarada(coverage.asset?.specifications),
          identifier:
            coverage.asset?.identifier ??
            coverage.asset?.serialNumber ??
            undefined,
          sector: coverage.asset?.location ?? undefined,
          coverageStart: dataSimples(coverage.startsOn),
        })),
        units: planUnits.map((link) => ({
          name: link.unit.name,
          checklist: link.unit.checklistTemplate?.name ?? undefined,
        })),
        procedure: roteiroDoPlano(plan.procedure),
        legalReference: PMOC_PLAN_LEGAL_REFERENCE,
      },
    });

    return {
      bytes,
      mimeType: 'application/pdf',
      fileName: `${plan.code}-plano.pdf`,
    };
  }

  async get(id: string, actor: PmocActor) {
    const plan = await this.plan(id, actor);
    /**
     * Paralelo de propósito: cada chamada abre a **própria** transação, então
     * não há conexão compartilhada. O que a PR-26.6.1 proíbe é concorrência de
     * consultas sobre o mesmo cliente transacional — outra coisa.
     */
    const [coverages, current, recent, planUnits] = await Promise.all([
      this.repository.listCoverages(id, actor.organizationId),
      this.repository.currentExecution(id, actor.organizationId),
      this.repository.listExecutions(id, actor.organizationId),
      this.repository.listPlanUnits(id, actor.organizationId),
    ]);

    return this.mapper.details(plan, {
      coverages,
      currentExecution: current,
      recentExecutions: recent,
      units: planUnits.map((link) => link.unit),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Máquina de estados                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Ativar é o que faz o plano começar a valer.
   *
   * Três coisas acontecem juntas, e nesta ordem: o plano ganha o primeiro
   * vencimento, o ciclo correspondente é aberto e o compromisso entra na
   * **Agenda existente**. Sem a terceira, o plano só existiria para quem abrisse
   * a tela de PMOC — e a manutenção é trabalho de campo, que se organiza pela
   * agenda.
   */
  async activate(id: string, actor: PmocActor) {
    const plan = await this.plan(id, actor);
    if (plan._count.coverages === 0) {
      throw new ConflictException(
        'A PMOC plan needs at least one covered equipment before activation',
      );
    }
    if (plan.status === 'ACTIVE') {
      const cycle = await this.repository.currentExecution(
        plan.id,
        actor.organizationId,
      );
      if (!cycle)
        throw new ConflictException('Active PMOC plan has no current cycle');
      await this.ensureSchedulingEvent(plan, cycle.id, actor);
      await this.scheduleDueChecks(plan, actor);
      return this.mapper.summary(plan);
    }
    this.assertTransition(plan.status, 'ACTIVE');

    if (plan.endsOn && plan.endsOn < this.today()) {
      throw new ConflictException(
        'This plan cannot be activated: its validity has already ended',
      );
    }

    const activated = await this.repository.activate(
      id,
      actor.organizationId,
      actor.actorId,
    );
    if (!activated) {
      throw new ConflictException('This plan is no longer activatable');
    }

    await this.ensureSchedulingEvent(
      activated.plan,
      activated.executionId,
      actor,
    );
    await this.scheduleDueChecks(activated.plan, actor);
    return this.mapper.summary(activated.plan);
  }

  async suspend(id: string, actor: PmocActor) {
    const plan = await this.plan(id, actor);
    this.assertTransition(plan.status, 'SUSPENDED');

    const updated = await this.repository.update(
      id,
      actor.organizationId,
      actor.actorId,
      { status: 'SUSPENDED' },
      'PMOC_PLAN_SUSPENDED',
      { status: plan.status },
    );
    return this.mapper.summary(updated);
  }

  /**
   * Cancelar é terminal, e não apaga o histórico.
   *
   * Os ciclos cumpridos continuam registrados: eles são a prova de que a
   * manutenção aconteceu, e um cancelamento posterior não a desfaz.
   */
  async cancel(id: string, actor: PmocActor) {
    const plan = await this.plan(id, actor);
    this.assertTransition(plan.status, 'CANCELLED');

    const updated = await this.repository.update(
      id,
      actor.organizationId,
      actor.actorId,
      { status: 'CANCELLED', nextDueOn: null },
      'PMOC_PLAN_CANCELLED',
      { status: plan.status },
    );
    return this.mapper.summary(updated);
  }

  /* ---------------------------------------------------------------- */
  /* Cobertura                                                         */
  /* ---------------------------------------------------------------- */

  async addCoverage(id: string, actor: PmocActor, input: AddPmocCoverageDto) {
    const plan = await this.plan(id, actor);
    if (plan.status === 'CANCELLED' || plan.status === 'EXPIRED') {
      throw new ConflictException(
        `Equipment cannot be added to a ${plan.status.toLowerCase()} plan`,
      );
    }

    const asset = await this.repository.findAsset(
      input.assetId,
      actor.organizationId,
    );
    /**
     * Equipamento de outro tenant, ou inexistente: a mesma resposta.
     *
     * Um 404 e um 403 diferentes contariam a quem tentou que aquele
     * identificador existe em algum lugar.
     */
    if (!asset) throw new EntityNotFoundException('Asset', input.assetId);

    /**
     * A unidade precisa bater.
     *
     * Quem executa a manutenção é a equipe da unidade do plano; cobrir um
     * equipamento de outra filial produziria uma ordem de serviço que ninguém
     * daquela unidade consegue abrir.
     */
    if (asset.businessUnitId !== plan.businessUnit.id) {
      throw new ValidationException(
        'The equipment belongs to a different business unit than the plan',
      );
    }

    const startsOn = input.startsOn ?? toDateOnly(plan.startsOn);
    this.assertValidity(startsOn, input.endsOn ?? null);

    try {
      const coverage = await this.repository.addCoverage({
        organizationId: actor.organizationId,
        planId: id,
        assetId: input.assetId,
        startsOn: new Date(`${startsOn}T00:00:00.000Z`),
        endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null,
        notes: input.notes ?? null,
        actorId: actor.actorId,
      });
      return this.mapper.coverage(coverage);
    } catch (error) {
      /** O índice único é a autoridade sobre duplicidade, não uma checagem. */
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This equipment is already covered by the plan',
        );
      }
      throw error;
    }
  }

  async removeCoverage(id: string, coverageId: string, actor: PmocActor) {
    await this.plan(id, actor);
    const removed = await this.repository.removeCoverage(
      coverageId,
      id,
      actor.organizationId,
      actor.actorId,
    );
    if (!removed) {
      throw new EntityNotFoundException('PmocEquipmentCoverage', coverageId);
    }
  }

  coverages(id: string, actor: PmocActor) {
    return this.plan(id, actor).then(() =>
      this.repository
        .listCoverages(id, actor.organizationId)
        .then((rows) => rows.map((row) => this.mapper.coverage(row))),
    );
  }

  async coveragesPage(
    id: string,
    actor: PmocActor,
    query: PmocCoveragePageQueryDto,
  ): Promise<PmocCursorPageReadModel<PmocCoverageReadModel>> {
    await this.plan(id, actor);
    const cursor = this.decodeCursor<{ name: string; id: string }>(
      query.cursor,
    );
    const rows = await this.repository.listCoveragesPage({
      planId: id,
      organizationId: actor.organizationId,
      limit: query.limit,
      cursor,
      search: query.search,
      status: query.status,
    });
    const hasNextPage = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => this.mapper.coverage(row)),
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? this.encodeCursor({ name: last.asset.name, id: last.id })
          : null,
    };
  }

  async timeline(
    id: string,
    actor: PmocActor,
    query: PmocTimelineQueryDto,
  ): Promise<PmocCursorPageReadModel<PmocTimelineItemReadModel>> {
    await this.plan(id, actor);
    const decoded = this.decodeCursor<{ occurredAt: string; id: string }>(
      query.cursor,
    );
    const cursor = decoded
      ? { occurredAt: new Date(decoded.occurredAt), id: decoded.id }
      : null;
    if (cursor && Number.isNaN(cursor.occurredAt.getTime()))
      throw new ValidationException('Invalid timeline cursor');
    const result = await this.repository.listTimelinePage({
      planId: id,
      organizationId: actor.organizationId,
      limit: query.limit,
      cursor,
    });
    const hasNextPage = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const assets = new Map(result.assets.map((asset) => [asset.id, asset]));
    const data = rows.map((row) => {
      const values = (row.after ?? {}) as Record<string, unknown>;
      const equipment =
        typeof values.assetId === 'string'
          ? (assets.get(values.assetId) ?? null)
          : null;
      return {
        id: row.id,
        type: row.action,
        message: this.timelineMessage(row.action, equipment?.name),
        occurredAt: row.createdAt.toISOString(),
        actor: row.user,
        equipment,
        data: values,
      };
    });
    const last = rows.at(-1);
    return {
      data,
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? this.encodeCursor({
              occurredAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Ciclos                                                            */
  /* ---------------------------------------------------------------- */

  executions(id: string, actor: PmocActor) {
    return this.plan(id, actor).then(() =>
      this.repository
        .listExecutions(id, actor.organizationId, 50)
        .then((rows) => rows.map((row) => this.mapper.execution(row))),
    );
  }

  /**
   * Conclui o ciclo e rola a periodicidade.
   *
   * `performedAt` é quando a manutenção aconteceu — o padrão é agora, mas uma
   * visita de ontem registrada hoje conta como ontem, e a próxima é contada a
   * partir dali.
   */
  async completeExecution(
    planId: string,
    executionId: string,
    actor: PmocActor,
    input: CompletePmocExecutionDto,
  ) {
    const plan = await this.plan(planId, actor);
    const execution = await this.repository.findExecution(
      executionId,
      actor.organizationId,
    );
    if (!execution || execution.planId !== planId) {
      throw new EntityNotFoundException('PmocExecution', executionId);
    }
    if (execution.status !== 'PENDING') {
      throw new ConflictException(
        `This cycle is already ${execution.status.toLowerCase()}`,
      );
    }

    const performedAt = input.performedAt ?? new Date();
    if (performedAt.getTime() > Date.now() + 60_000) {
      throw new ValidationException(
        'A maintenance cannot be recorded in the future',
      );
    }

    if (input.artifactExecutionId) {
      await this.assertEvidence(
        input.artifactExecutionId,
        actor,
        plan.businessUnit.id,
      );
    }

    const rolled = await this.repository.completeExecution({
      executionId,
      planId,
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      performedAt,
      artifactExecutionId: input.artifactExecutionId ?? null,
      notes: input.notes ?? null,
    });

    if (!rolled) {
      throw new ConflictException('This cycle was completed by someone else');
    }

    const refreshed = await this.plan(planId, actor);
    await this.openCycleAndSchedule(refreshed, actor);

    return this.get(planId, actor);
  }

  /**
   * Vincula a evidência documental a um ciclo.
   *
   * A execução de artefato precisa **existir** e ser do tipo PMOC. Criar uma
   * aqui para "ter documento" produziria um formulário que ninguém preencheu —
   * e um PMOC assinado por ninguém é pior que um PMOC ausente.
   */
  async linkEvidence(
    planId: string,
    executionId: string,
    actor: PmocActor,
    input: LinkPmocEvidenceDto,
  ) {
    const plan = await this.plan(planId, actor);
    const execution = await this.repository.findExecution(
      executionId,
      actor.organizationId,
    );
    if (!execution || execution.planId !== planId) {
      throw new EntityNotFoundException('PmocExecution', executionId);
    }

    await this.assertEvidence(
      input.artifactExecutionId,
      actor,
      plan.businessUnit.id,
    );

    try {
      await this.repository.attachEvidence(
        executionId,
        input.artifactExecutionId,
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This artifact execution is already linked to another PMOC cycle',
        );
      }
      throw error;
    }

    return this.get(planId, actor);
  }

  /**
   * Gera a ordem de serviço do ciclo.
   *
   * **Idempotente**: chamada duas vezes devolve a mesma ordem. O ciclo guarda
   * `operationId` sob trava consultiva — dois cliques, um retry da fila e uma
   * automação disparando ao mesmo tempo convergem para uma ordem só.
   *
   * Técnico e agendamento **não** são atribuídos: são decisões de quem organiza
   * o dia, e escolher por eles produziria uma ordem que ninguém combinou.
   */
  async createOperation(
    planId: string,
    executionId: string,
    actor: PmocActor,
    input: CreatePmocOperationDto,
  ) {
    this.assertPermission(
      actor,
      'operations.create',
      'Generating an operation requires permission to create operations',
    );

    const plan = await this.plan(planId, actor);
    const execution = await this.repository.findExecution(
      executionId,
      actor.organizationId,
    );
    if (!execution || execution.planId !== planId) {
      throw new EntityNotFoundException('PmocExecution', executionId);
    }
    if (execution.status === 'CANCELLED') {
      throw new ConflictException('This cycle was cancelled');
    }

    const asset = await this.repository.firstCoveredAsset(
      planId,
      actor.organizationId,
    );

    const code = await this.operationCode(
      actor.organizationId,
      plan.code,
      execution.dueOn,
    );

    const result = await this.repository.createOperation({
      executionId,
      organizationId: actor.organizationId,
      businessUnitId: plan.businessUnit.id,
      customerId: plan.customer.id,
      assetId: asset?.assetId ?? null,
      actorId: actor.actorId,
      code,
      kind: input.kind ?? 'MAINTENANCE',
      title: `${plan.name} — manutenção ${toDateOnly(execution.dueOn)}`,
      description: `Gerada pelo plano PMOC ${plan.code}.`,
      scheduledStart: input.scheduledStart ?? null,
      scheduledEnd: input.scheduledEnd ?? null,
    });

    return {
      operationId: result.operationId,
      created: result.created,
      plan: await this.get(planId, actor),
    };
  }

  async equipmentExecutionPreparation(
    planId: string,
    cycleId: string,
    assetId: string,
    actor: PmocActor,
  ) {
    const data = await this.repository.executionPreparation(
      actor.organizationId,
      planId,
      cycleId,
      assetId,
    );
    if (!data)
      throw new EntityNotFoundException('PmocEquipmentCoverage', assetId);
    this.assertUnitInScope(actor, data.plan.businessUnitId);
    const technicalResponsibleEligibility = data.plan.technicalResponsibleUserId
      ? await this.workforce.professionalEligibility(
          actor.organizationId,
          data.plan.technicalResponsibleUserId,
          {
            signedAs: 'TECHNICAL_RESPONSIBLE',
            documentType: 'PMOC',
            businessUnitId: data.plan.businessUnitId,
          },
        )
      : null;
    const [fieldTechnicians, auxiliaryTechnicians] = await Promise.all([
      this.workforce.listProfessionals(
        actor.organizationId,
        'FIELD_TECHNICIAN',
        data.plan.businessUnitId,
      ),
      this.workforce.listProfessionals(
        actor.organizationId,
        'FIELD_TECHNICIAN',
        data.plan.businessUnitId,
      ),
    ]);
    const eligibility = executionEligibility({
      planStatus: data.plan.status,
      cycleStatus: data.cycle.status,
      equipmentStatus: data.coverage.asset.status,
      technicalResponsibleUserId: data.plan.technicalResponsibleUserId,
      technicalResponsible: technicalResponsibleEligibility,
    });
    const blockedReasons = eligibility.blockedReasons;
    return {
      plan: {
        id: data.plan.id,
        code: data.plan.code,
        name: data.plan.name,
        reviewRequired: data.plan.reviewRequired,
      },
      cycle: { ...data.cycle, dueOn: toDateOnly(data.cycle.dueOn) },
      customer: {
        id: data.plan.customer.id,
        name: data.plan.customer.tradeName ?? data.plan.customer.legalName,
      },
      equipment: data.coverage.asset,
      serviceLocation: data.plan.serviceLocation,
      scope: data.plan.scope,
      serviceTypes: data.plan.serviceTypes,
      procedure: data.plan.procedure,
      /*
       * O roteiro já lido, em grupos.
       *
       * `procedure` é JSON livre e tem duas formas em produção. O leitor tolerante
       * que o documento usa mora aqui; publicar o resultado evita um segundo
       * leitor no navegador — e garante que a tela mostre exatamente os itens que
       * o PDF vai imprimir, que é o que o técnico confere em campo.
       */
      procedureGroups: roteiroDoPlano(data.plan.procedure),
      technicalResponsible: data.plan.technicalResponsible,
      technicalResponsibleEligibility,
      fieldTechnicians,
      auxiliaryTechnicians,
      evidencePolicy: {
        minimumPhotos: 0,
        maximumPhotos: 6,
        acceptedKinds: ['PHOTO', 'VIDEO', 'DOCUMENT'],
      },
      documentPolicy: {
        artifactType: 'PMOC',
        signatory: 'TECHNICAL_RESPONSIBLE',
        fieldTechnicianAutoSigns: false,
      },
      suggestedExecutionTime: {
        dueOn: toDateOnly(data.cycle.dueOn),
        timezone: 'America/Recife',
      },
      eligibility,
      existingExecution: data.existing
        ? this.mapper.equipmentExecution(data.existing)
        : null,
      allowedActions: data.existing
        ? data.existing.status === 'IN_PROGRESS'
          ? ['COMPLETE', 'ADD_EVIDENCE']
          : ['VIEW']
        : blockedReasons.length
          ? []
          : ['START'],
    };
  }

  /**
   * Os equipamentos cobertos por um ciclo, com o que cada um pode fazer agora.
   *
   * `eligibility` é a **mesma** função que a preparação usa. Publicá-la aqui
   * existe por um motivo medido: sem ela, a tela pedia a preparação inteira
   * para cada equipamento sem execução — vinte requisições para desenhar vinte
   * linhas. Quatro dos cinco motivos são do plano e do ciclo e se calculam uma
   * vez; o quinto é o estado do próprio equipamento, que já vem na consulta.
   *
   * É uma leitura, e leitura envelhece: entre ver "pronto" e clicar em iniciar,
   * o plano pode ter sido suspenso. Quem decide continua sendo
   * `startEquipmentExecution`, que revalida contra o estado do momento e
   * recusa. O que está aqui informa a tela; não autoriza nada.
   */
  async equipmentExecutions(planId: string, cycleId: string, actor: PmocActor) {
    const plan = await this.plan(planId, actor);
    const [rows, cycle, technicalResponsible] = await Promise.all([
      this.repository.listEquipmentExecutions(
        actor.organizationId,
        planId,
        cycleId,
      ),
      this.repository.findCycle(actor.organizationId, planId, cycleId),
      plan.technicalResponsibleUserId
        ? this.workforce.professionalEligibility(
            actor.organizationId,
            plan.technicalResponsibleUserId,
            {
              signedAs: 'TECHNICAL_RESPONSIBLE',
              documentType: 'PMOC',
              businessUnitId: plan.businessUnit.id,
            },
          )
        : Promise.resolve(null),
    ]);
    if (!cycle) throw new EntityNotFoundException('PmocExecution', cycleId);

    return rows.map((row) => ({
      coverageId: row.id,
      equipment: row.asset,
      execution: row.equipmentExecutions[0]
        ? this.mapper.equipmentExecution(row.equipmentExecutions[0])
        : null,
      status: row.equipmentExecutions[0]?.status ?? 'NOT_STARTED',
      eligibility: executionEligibility({
        planStatus: plan.status,
        cycleStatus: cycle.status,
        equipmentStatus: row.asset.status,
        technicalResponsibleUserId: plan.technicalResponsibleUserId,
        technicalResponsible,
      }),
    }));
  }

  /**
   * O técnico começa **o atendimento dele**, do celular.
   *
   * ## Por que é um método separado, e não um parâmetro
   *
   * São duas autoridades diferentes sobre a mesma escrita. Quem **gerencia** o
   * PMOC (`pmoc.manage`) abre a execução e escala quem quiser: é o dono ou o
   * administrador organizando o trabalho. Quem **executa** (`pmoc.execute`) abre
   * apenas a sua, e só onde o plano lhe foi atribuído: é o técnico que chegou ao
   * local.
   *
   * Um parâmetro "para mim" na rota de gerenciar faria a mesma porta aceitar as
   * duas autoridades, e a verificação viraria um `if` no meio do corpo — o tipo
   * de lugar onde uma permissão a menos passa sem ninguém notar.
   *
   * ## Por que o técnico não usa a rota de gerenciar
   *
   * Ela exige `pmoc.manage`, que o papel de campo não tem — e não deve ter:
   * gerenciar contrato não é trabalho de quem vai à casa de máquinas. Antes
   * disto, a consequência era o técnico **não conseguir atender** um PMOC nem
   * quando o plano era dele.
   */
  async startMyEquipmentExecution(
    planId: string,
    cycleId: string,
    assetId: string,
    actor: PmocActor,
  ) {
    const preparation = await this.repository.executionPreparation(
      actor.organizationId,
      planId,
      cycleId,
      assetId,
    );
    if (!preparation) {
      throw new EntityNotFoundException('PmocEquipmentCoverage', assetId);
    }

    /*
     * A atribuição é do **plano**, e é o que autoriza.
     *
     * `technicianUserId` é a referência operacional: quem atende este contrato.
     * O dono passa sem ela, pela mesma razão de sempre — é ele que atende quando
     * o escalado faltou.
     */
    if (
      !actor.isOrganizationOwner &&
      preparation.plan.technicianUserId !== actor.actorId
    ) {
      throw new ForbiddenException(
        'Este PMOC não está atribuído a você. Só o técnico atribuído — ou o dono da organização — pode atendê-lo.',
      );
    }

    return this.startEquipmentExecution(planId, cycleId, assetId, actor, {
      /* Abre para si mesmo. É o que distingue esta porta da outra. */
      responsibleFieldTechnicianId: actor.actorId,
    });
  }

  async startEquipmentExecution(
    planId: string,
    cycleId: string,
    assetId: string,
    actor: PmocActor,
    input: StartPmocEquipmentExecutionDto,
  ) {
    const preparation = await this.repository.executionPreparation(
      actor.organizationId,
      planId,
      cycleId,
      assetId,
    );
    if (!preparation)
      throw new EntityNotFoundException('PmocEquipmentCoverage', assetId);
    if (
      preparation.plan.status !== 'ACTIVE' ||
      preparation.cycle.status !== 'PENDING'
    )
      throw new ConflictException(
        'PMOC plan and cycle must be active and pending',
      );
    if (preparation.coverage.asset.status !== 'ACTIVE')
      throw new ConflictException('Equipment is inactive');
    if (!preparation.plan.technicalResponsibleUserId)
      throw new ValidationException('TECHNICAL_RESPONSIBLE_MISSING');
    await this.assertTechnicalResponsible(
      preparation.plan.technicalResponsibleUserId,
      actor,
      preparation.plan.businessUnitId,
      true,
    );
    const professionals = await this.workforce.listProfessionals(
      actor.organizationId,
      'FIELD_TECHNICIAN',
      preparation.plan.businessUnitId,
    );
    const eligible = new Set(professionals.map((item) => item.id));
    if (!eligible.has(input.responsibleFieldTechnicianId))
      throw new ValidationException(
        'Responsible field technician is not eligible for this business unit',
      );
    const auxiliaries = [...new Set(input.auxiliaryTechnicianIds ?? [])].filter(
      (id) => id !== input.responsibleFieldTechnicianId,
    );
    if (auxiliaries.some((id) => !eligible.has(id)))
      throw new ValidationException(
        'One or more auxiliary technicians are not eligible for this business unit',
      );
    const result = await this.repository.startEquipmentExecution({
      organizationId: actor.organizationId,
      planId,
      cycleId,
      coverageId: preparation.coverage.id,
      assetId,
      businessUnitId: preparation.plan.businessUnitId,
      customerId: preparation.plan.customer.id,
      responsibleFieldTechnicianId: input.responsibleFieldTechnicianId,
      auxiliaryTechnicianIds: auxiliaries,
      actorId: actor.actorId,
      procedureSnapshot: preparation.plan.procedure as never,
      technicalResponsibleSnapshot: {
        userId: preparation.plan.technicalResponsible!.id,
        displayName: preparation.plan.technicalResponsible!.displayName,
        signature: preparation.technicalResponsibleSignature,
        credential: preparation.technicalResponsibleCredential,
      },
      code: await this.operationCode(
        actor.organizationId,
        `${preparation.plan.code}-${preparation.coverage.asset.identifier ?? preparation.coverage.asset.id.slice(0, 8)}`,
        preparation.cycle.dueOn,
      ),
      title: `${preparation.plan.name} — ${preparation.coverage.asset.name}`,
    });
    return {
      created: result.created,
      execution: this.mapper.equipmentExecution(result.execution),
    };
  }

  async addEquipmentEvidence(
    executionId: string,
    actor: PmocActor,
    input: AddPmocEquipmentEvidenceDto,
  ) {
    const result = await this.repository.addEquipmentEvidence({
      organizationId: actor.organizationId,
      executionId,
      storageFileId: input.storageFileId,
      kind: input.kind ?? 'PHOTO',
      caption: input.caption ?? null,
      actorId: actor.actorId,
    });
    if (!result)
      throw new EntityNotFoundException(
        'PmocEquipmentExecutionOrStorageFile',
        executionId,
      );
    if (result.limitReached)
      throw new ConflictException(
        'A PMOC equipment execution accepts at most 6 evidence files',
      );
    return { id: result.evidence.id };
  }

  async linkEquipmentArtifact(
    executionId: string,
    actor: PmocActor,
    input: LinkPmocEvidenceDto,
  ) {
    this.assertPermission(
      actor,
      'artifact_executions.read',
      'Linking the PMOC document requires artifact_executions.read',
    );
    const result = await this.repository.linkEquipmentArtifact(
      actor.organizationId,
      executionId,
      input.artifactExecutionId,
    );
    if (!result)
      throw new EntityNotFoundException('PmocEquipmentExecution', executionId);
    if (result.invalidArtifact)
      throw new ValidationException(
        'Artifact must be a PMOC execution for the same equipment and business unit',
      );
    return { executionId, artifactExecutionId: input.artifactExecutionId };
  }

  /**
   * O técnico emite o relatório **da execução dele**.
   *
   * Porta separada da de gerenciar pela mesma razão de `startMyEquipmentExecution`:
   * são duas autoridades sobre a mesma escrita, e quem executa só emite a sua.
   * O dono emite qualquer uma — é ele que fecha o que o técnico que faltou
   * deixou aberto.
   */
  async generateMyEquipmentArtifact(
    executionId: string,
    actor: PmocActor,
    input: GeneratePmocEquipmentArtifactDto,
  ) {
    return this.generateEquipmentArtifact(
      executionId,
      actor,
      input,
      actor.isOrganizationOwner ? null : actor.actorId,
    );
  }

  async generateEquipmentArtifact(
    executionId: string,
    actor: PmocActor,
    input: GeneratePmocEquipmentArtifactDto,
    restrictToTechnicianId: string | null = null,
  ) {
    this.assertPermission(
      actor,
      'artifact_rendering.render',
      'Generating the PMOC document requires artifact_rendering.render',
    );
    const result = await this.repository.createEquipmentArtifact(
      actor.organizationId,
      executionId,
      actor.actorId,
      restrictToTechnicianId,
    );
    if (!result)
      throw new EntityNotFoundException(
        'CompletedPmocEquipmentExecutionOrTemplate',
        executionId,
      );
    if ('refused' in result) {
      /* A mensagem nomeia a regra — quem lê descobre que precisa da escala, e
         não que o documento falhou. */
      throw new ForbiddenException(
        'Só o técnico escalado para esta execução — ou o dono da organização — pode emitir o relatório dela.',
      );
    }
    if (
      result.renderStatus === 'NOT_RENDERED' ||
      result.renderStatus === 'FAILED'
    ) {
      await this.rendering.request(
        result.artifactExecutionId,
        { organizationId: actor.organizationId, actorId: actor.actorId },
        {
          renderer: input.renderer,
          metadata: {
            sourceType: 'PMOC_EQUIPMENT_EXECUTION',
            sourceEntityId: executionId,
          },
        },
      );
    }
    return {
      artifactExecutionId: result.artifactExecutionId,
      created: result.created,
      sourceType: 'PMOC_EQUIPMENT_EXECUTION',
      sourceEntityId: executionId,
    };
  }

  async completeEquipmentExecution(
    planId: string,
    cycleId: string,
    executionId: string,
    actor: PmocActor,
    input: CompletePmocEquipmentExecutionDto,
  ) {
    const performedAt = input.performedAt ?? new Date();
    if (performedAt.getTime() > Date.now() + 60_000)
      throw new ValidationException(
        'A maintenance cannot be recorded in the future',
      );
    /*
     * Quem atende é quem foi escalado — ou o dono.
     *
     * `pmoc.manage` diz que a pessoa **administra** o módulo: cria plano, cobre
     * equipamento, encerra contrato. Executar a manutenção de um aparelho é outra
     * coisa, e quem responde por ela é o técnico escalado para aquela execução.
     * Sem esta linha, qualquer pessoa com acesso ao módulo assinava a manutenção
     * de um aparelho que nunca viu — e o documento sai com o nome dela.
     *
     * O dono passa sem atribuição: é ele que atende quando o técnico escalado
     * faltou, e negar isso deixaria a operação parada esperando uma reatribuição.
     */
    const result = await this.repository.completeEquipmentExecution({
      organizationId: actor.organizationId,
      planId,
      cycleId,
      executionId,
      actorId: actor.actorId,
      restrictToTechnicianId: actor.isOrganizationOwner ? null : actor.actorId,
      performedAt,
      notes: input.notes ?? null,
    });

    if (result.refused === 'NOT_FOUND') {
      throw new EntityNotFoundException('PmocEquipmentExecution', executionId);
    }
    if (result.refused === 'NOT_ASSIGNED') {
      /* A recusa diz qual recusa é: "não está em andamento" mandaria a pessoa
         procurar o estado errado. */
      throw new ForbiddenException(
        'Só o técnico escalado para esta execução — ou o dono da organização — pode concluí-la.',
      );
    }
    if (result.refused === 'NOT_IN_PROGRESS') {
      throw new ConflictException('Equipment execution is not in progress');
    }
    if (result.allResolved) {
      const refreshed = await this.plan(planId, actor);
      await this.openCycleAndSchedule(refreshed, actor);
    }
    return {
      execution: this.mapper.equipmentExecution(result.execution),
      cycleCompleted: result.allResolved,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Conformidade                                                      */
  /* ---------------------------------------------------------------- */

  async compliance(
    actor: PmocActor,
    query: PmocAnalyticsQueryDto,
  ): Promise<PmocComplianceSummaryReadModel> {
    const summary = await this.repository.complianceSummary(
      actor.organizationId,
      query,
    );

    const upToDate = Number(summary.plans?.up_to_date ?? 0);
    const dueSoon = Number(summary.plans?.due_soon ?? 0);
    const overdue = Number(summary.plans?.overdue ?? 0);
    const evaluated = upToDate + dueSoon + overdue;

    return {
      period: {
        from: summary.period.from.toISOString(),
        to: summary.period.to.toISOString(),
      },
      plans: {
        total: Number(summary.plans?.total ?? 0),
        draft: Number(summary.plans?.draft ?? 0),
        active: Number(summary.plans?.active ?? 0),
        suspended: Number(summary.plans?.suspended ?? 0),
        expired: Number(summary.plans?.expired ?? 0),
        cancelled: Number(summary.plans?.cancelled ?? 0),
      },
      compliance: {
        upToDate,
        dueSoon,
        overdue,
        /**
         * `em dia ÷ avaliados`, com uma casa.
         *
         * `null` quando não há plano ativo: "100%" de nada afirmaria uma
         * conformidade que ninguém está mantendo — e é justamente o número que
         * alguém levaria para uma reunião.
         */
        upToDateRate:
          evaluated === 0 ? null : ((upToDate / evaluated) * 100).toFixed(1),
      },
      equipment: { covered: Number(summary.equipment?.covered ?? 0) },
      executions: {
        completedInPeriod: Number(summary.executions?.completed ?? 0),
        pending: Number(summary.executions?.pending ?? 0),
        overdue: Number(summary.executions?.overdue ?? 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * As unidades em atendimento, e em quantos planos ativos cada uma entra.
   *
   * Existe para o relatório: a conformidade diz **quantos** planos estão em dia,
   * e isto diz **o que** é atendido em cada visita. Sem a segunda metade, o PDF
   * afirma cobertura sem descrever serviço — que é exatamente o que um PMOC
   * precisa provar.
   *
   * A mesma leitura da tela, pela mesma régua: unidade viva, plano ativo.
   */
  async unitCoverage(
    actor: PmocActor,
    query: { businessUnitId?: string } = {},
  ): Promise<
    readonly {
      key: string;
      name: string;
      checklistName: string | null;
      checklistItems: number;
      plans: number;
    }[]
  > {
    const links = await this.repository.listActiveUnitLinks(
      actor.organizationId,
      query.businessUnitId,
    );

    /** Agrupado por unidade; `Set` de planos porque o vínculo é por par. */
    const porUnidade = new Map<
      string,
      {
        key: string;
        name: string;
        sortOrder: number;
        checklistName: string | null;
        checklistItems: number;
        plans: Set<string>;
      }
    >();

    for (const link of links) {
      const atual = porUnidade.get(link.unit.id);
      if (atual) {
        atual.plans.add(link.planId);
        continue;
      }
      porUnidade.set(link.unit.id, {
        key: link.unit.key,
        name: link.unit.name,
        sortOrder: link.unit.sortOrder,
        checklistName: link.unit.checklistTemplate?.name ?? null,
        checklistItems: Array.isArray(link.unit.checklistTemplate?.items)
          ? link.unit.checklistTemplate.items.length
          : 0,
        plans: new Set([link.planId]),
      });
    }

    return [...porUnidade.values()]
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'),
      )
      .map((unidade) => ({
        key: unidade.key,
        name: unidade.name,
        checklistName: unidade.checklistName,
        checklistItems: unidade.checklistItems,
        plans: unidade.plans.size,
      }));
  }

  async upcoming(
    actor: PmocActor,
    query: PmocUpcomingQueryDto,
  ): Promise<PmocUpcomingReadModel[]> {
    const rows = await this.repository.upcoming(actor.organizationId, query);
    const now = new Date();

    return rows.map((row) => {
      const evaluated = evaluateCompliance({
        planStatus: 'ACTIVE',
        nextDueOn: row.due_on,
        dueSoonDays: row.due_soon_days,
        today: now,
      });

      return {
        planId: row.plan_id,
        planCode: row.plan_code,
        planName: row.plan_name,
        executionId: row.execution_id,
        dueOn: toDateOnly(row.due_on),
        daysUntilDue: evaluated.daysUntilDue,
        compliance: evaluated.status,
        businessUnit: {
          id: row.business_unit_id,
          name: row.business_unit_name,
        },
        customer: { id: row.customer_id, name: row.customer_name },
        coveredEquipment: Number(row.covered),
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private async plan(id: string, actor: PmocActor) {
    const plan = await this.repository.find(id, actor.organizationId);
    if (!plan) throw new EntityNotFoundException('PmocPlan', id);
    return plan;
  }

  /**
   * Abre o ciclo do vencimento atual, põe na Agenda e agenda o aviso.
   *
   * Idempotente de ponta a ponta: o ciclo tem índice único por vencimento, o
   * evento de agenda só é criado quando o ciclo ainda não tem um, e o job de
   * aviso usa uma `jobKey` derivada do vencimento.
   */
  private async openCycleAndSchedule(
    plan: Awaited<ReturnType<PmocRepository['find']>>,
    actor: PmocActor,
  ): Promise<void> {
    if (!plan || plan.status !== 'ACTIVE' || !plan.nextDueOn) return;

    const executionId = await this.repository.openCycle(
      actor.organizationId,
      plan.id,
      plan.nextDueOn,
    );
    if (!executionId) return;

    await this.ensureSchedulingEvent(plan, executionId, actor);
    await this.scheduleDueChecks(plan, actor);
  }

  /**
   * O compromisso entra na **Agenda existente**.
   *
   * Um `SchedulingEvent` com `sourceModule: 'pmoc'` — não uma agenda paralela,
   * não uma recorrência própria. A recorrência do PMOC é o próprio plano: cada
   * ciclo cria o evento do seu vencimento, e o seguinte nasce quando este for
   * cumprido. Uma regra de recorrência no Scheduling duplicaria a periodicidade
   * em dois lugares, e elas divergiriam no primeiro atraso.
   */
  private async ensureSchedulingEvent(
    plan: NonNullable<Awaited<ReturnType<PmocRepository['find']>>>,
    executionId: string,
    actor: PmocActor,
  ): Promise<void> {
    if (plan.schedulingPaused) return;
    const execution = await this.repository.findExecution(
      executionId,
      actor.organizationId,
    );
    if (!execution || execution.schedulingEventId) return;

    const calendar = await this.repository.defaultCalendar(
      actor.organizationId,
      plan.businessUnit.id,
    );
    /** Sem calendário não há onde marcar — e o plano continua válido. */
    if (!calendar || !plan.nextDueOn) return;

    const startsAt = instantFromCivilDate(
      toDateOnly(plan.nextDueOn),
      calendar.timezone,
      12,
    );
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);

    await this.repository.ensureSchedulingEvent(executionId, {
      id: generateUuidV7(),
      organizationId: actor.organizationId,
      businessUnitId: plan.businessUnit.id,
      calendarId: calendar.id,
      customerId: plan.customer.id,
      createdById: actor.actorId,
      title: `PMOC ${plan.code} — manutenção prevista`,
      description: plan.name,
      type: 'MAINTENANCE',
      status: 'TENTATIVE',
      startsAt,
      endsAt,
      timezone: calendar.timezone,
      sourceModule: 'pmoc',
      sourceEntityType: 'PMOC_PLAN',
      sourceEntityId: plan.id,
      metadata: { executionId, dueOn: toDateOnly(plan.nextDueOn) },
    });
  }

  /**
   * Agenda os dois avisos deste vencimento, na fila que já existe.
   *
   * Um job para o momento em que o plano entra em "próximo do vencimento" e
   * outro para o dia seguinte ao vencimento. **Não é um cron**: são dois jobs
   * com `available_at`, derivados do vencimento do plano, e a `jobKey` os torna
   * idempotentes — reativar o plano dez vezes não cria vinte avisos.
   *
   * O que torna isso correto sem varredura global: o próximo ciclo agenda os
   * seus próprios avisos quando é criado. Ninguém precisa abrir tela nenhuma.
   */
  private async scheduleDueChecks(
    plan: NonNullable<Awaited<ReturnType<PmocRepository['find']>>>,
    actor: PmocActor,
  ): Promise<void> {
    if (!plan.nextDueOn || plan.schedulingPaused) return;

    const dueOn = toDateOnly(plan.nextDueOn);
    const dueAt = new Date(`${dueOn}T09:00:00.000Z`);
    const warnAt = new Date(
      dueAt.getTime() - plan.dueSoonDays * 24 * 60 * 60 * 1000,
    );
    const overdueAt = new Date(dueAt.getTime() + 24 * 60 * 60 * 1000);

    for (const [phase, availableAt] of [
      ['DUE_SOON', warnAt],
      ['OVERDUE', overdueAt],
    ] as const) {
      await this.jobs.enqueue({
        queue: JOB_QUEUES.pmocDueCheck,
        jobKey: `pmoc:${plan.id}:${dueOn}:${phase}`,
        organizationId: actor.organizationId,
        /** O aviso é do plano, e o plano é de uma unidade. */
        scope: 'BUSINESS_UNIT',
        businessUnitId: plan.businessUnit.id,
        payload: { planId: plan.id, dueOn, phase },
        correlationId: generateUuidV7(),
        actorUserId: actor.actorId,
        /** No passado significa "agora": a fila não olha para trás. */
        availableAt: availableAt < new Date() ? new Date() : availableAt,
      });
    }
  }

  private assertTransition(from: string, to: PlanStatus): void {
    if (!canTransition(from, to)) {
      throw new ConflictException(
        `A ${from.toLowerCase()} plan cannot become ${to.toLowerCase()}`,
      );
    }
  }

  private async assertTechnicalResponsible(
    userId: string,
    actor: PmocActor,
    businessUnitId: string,
    requireSignature = false,
  ): Promise<void> {
    const professionals = await this.workforce.listProfessionals(
      actor.organizationId,
      'TECHNICAL_RESPONSIBLE',
      businessUnitId,
    );
    const professional = professionals.find((item) => item.id === userId);
    if (
      !professional ||
      (requireSignature && !professional.signatureAvailable)
    ) {
      throw new ValidationException(
        `Technical responsible is not eligible for PMOC: ${professional ? 'SIGNATURE_MISSING' : 'PROFESSIONAL_ROLE_OR_SCOPE_MISSING'}`,
      );
    }
  }

  private assertValidity(startsOn: string, endsOn: string | null): void {
    if (!DATE_ONLY.test(startsOn)) {
      throw new ValidationException('startsOn must be YYYY-MM-DD');
    }
    if (!endsOn) return;
    if (!DATE_ONLY.test(endsOn)) {
      throw new ValidationException('endsOn must be YYYY-MM-DD');
    }
    if (endsOn < startsOn) {
      throw new ValidationException('The validity ends before it starts');
    }
  }

  /**
   * A unidade precisa estar no recorte da sessão.
   *
   * A RLS já recusaria a escrita, mas com um erro de banco. Aqui a recusa é de
   * negócio, com a razão dita.
   */
  private assertUnitInScope(actor: PmocActor, businessUnitId: string): void {
    if (
      actor.businessUnitIds.length > 0 &&
      !actor.businessUnitIds.includes(businessUnitId)
    ) {
      throw new ForbiddenException('This business unit is out of your scope');
    }
  }

  private assertPermission(
    actor: PmocActor,
    permission: string,
    message: string,
  ): void {
    const granted = new Set(actor.permissions);
    if (!granted.has('*') && !granted.has(permission)) {
      throw new ForbiddenException(message);
    }
  }

  /**
   * A evidência precisa ser uma execução de artefato **de PMOC**.
   *
   * Vincular um checklist de instalação como evidência de PMOC produziria um
   * histórico que parece conforme e não é. O tipo vem do template, que é a
   * autoridade sobre o que aquele documento é.
   */
  private async assertEvidence(
    artifactExecutionId: string,
    actor: PmocActor,
    businessUnitId: string,
  ): Promise<void> {
    this.assertPermission(
      actor,
      'artifact_executions.read',
      'Linking evidence requires access to artifact executions',
    );

    const execution = await this.repository.findArtifactExecution(
      artifactExecutionId,
      actor.organizationId,
    );
    if (!execution) {
      throw new EntityNotFoundException(
        'ArtifactExecution',
        artifactExecutionId,
      );
    }
    if (execution.businessUnitId !== businessUnitId) {
      throw new ValidationException(
        'The evidence belongs to a different business unit than the plan',
      );
    }
    if (!execution.template.artifactType.toUpperCase().includes('PMOC')) {
      throw new ValidationException(
        `The evidence must be a PMOC artifact execution (received: ${execution.template.artifactType})`,
      );
    }
  }

  /**
   * Código da ordem gerada.
   *
   * Deriva do plano e do vencimento — `OS-PMOC-2026-001-2026-07-01` — para que a
   * origem seja legível na listagem de operações sem abrir nada. Ocupado, um
   * sufixo curto resolve; o índice único do banco continua sendo a autoridade.
   */
  private async operationCode(
    organizationId: string,
    planCode: string,
    dueOn: Date,
  ): Promise<string> {
    const seed = `OS-${planCode}-${toDateOnly(dueOn)}`
      .toUpperCase()
      .slice(0, 60);
    const taken = await this.repository.operationCodeTaken(
      organizationId,
      seed,
    );
    if (!taken) return seed;
    return `${seed}-${Date.now().toString(36).slice(-4)}`
      .toUpperCase()
      .slice(0, 60);
  }

  private encodeCursor(value: Record<string, string>): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  private decodeCursor<T>(cursor?: string): T | null {
    if (!cursor) return null;
    try {
      const value = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as T;
      if (!value || typeof value !== 'object') throw new Error('invalid');
      return value;
    } catch {
      throw new ValidationException('Invalid pagination cursor');
    }
  }

  private timelineMessage(action: string, equipmentName?: string): string {
    const equipment = equipmentName ? ` ${equipmentName}` : '';
    const messages: Record<string, string> = {
      PMOC_PLAN_CREATED: 'Plano PMOC criado.',
      PMOC_PLAN_ACTIVATED: 'Plano PMOC ativado e primeiro ciclo criado.',
      PMOC_COVERAGE_ADDED: `Equipamento${equipment} adicionado à cobertura.`,
      PMOC_COVERAGE_REMOVED: 'Equipamento removido da cobertura.',
      PMOC_EQUIPMENT_EXECUTION_STARTED: `Execução do equipamento${equipment} iniciada.`,
      PMOC_EQUIPMENT_EXECUTION_COMPLETED: `Execução do equipamento${equipment} concluída.`,
      PMOC_EQUIPMENT_ARTIFACT_CREATED: `Documento do equipamento${equipment} gerado.`,
      PMOC_EXECUTION_COMPLETED:
        'Ciclo PMOC concluído e próximo ciclo programado.',
    };
    return messages[action] ?? 'Plano PMOC atualizado.';
  }

  private today(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}

/** Reexportado para o processador do job, que compõe o mesmo tipo. */
export type { FrequencyUnit };
