import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OperationStatus } from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import type {
  AssignOperationUserDto,
  ChangeOperationStatusDto,
  CreateOperationDto,
  OperationQueryDto,
  UpdateOperationDto,
} from './dto/operation.dto';
import { OperationRepository } from './operation.repository';
import { requiresAssignmentAuthorization } from './operation-authorization';
import { OperationStorageService } from './operation-storage.service';
import { OperationStateMachine } from './operation-state-machine';
import { WorkforceRepository } from '../workforce/workforce.repository';
import { MobileNotificationService } from '../notifications/mobile-notification.service';
import {
  EntitlementService,
  UsageResource,
} from '../subscription-plans/entitlements';
import { generateUuidV7 } from '../../utils';
import { FileObjectService } from '../storage/file-object.service';
import type { OperationFieldRecordReadModel } from './operation.read-models';

@Injectable()
export class OperationService {
  private readonly logger = new Logger(OperationService.name);

  constructor(
    private readonly repository: OperationRepository,
    private readonly storage: OperationStorageService,
    private readonly workforce: WorkforceRepository,
    private readonly entitlements: EntitlementService,
    /** Assina as URLs das imagens do registro de campo. */
    private readonly files: FileObjectService,
    @Optional()
    private readonly mobileNotifications?: MobileNotificationService,
  ) {}

  list(organizationId: string, query: OperationQueryDto) {
    this.validateSchedule(query.scheduledFrom, query.scheduledTo);
    return this.repository.list(organizationId, query);
  }

  async get(id: string, organizationId: string) {
    const operation = await this.repository.find(id, organizationId);
    if (!operation) throw new EntityNotFoundException('Operation', id);
    return operation;
  }

  async create(
    organizationId: string,
    actorId: string,
    input: CreateOperationDto,
  ) {
    this.validateSchedule(input.scheduledStart, input.scheduledEnd);
    const assetIds = [...new Set(input.assetIds ?? [])];
    const references = await this.validateReferences(
      organizationId,
      input.businessUnitId,
      input.customerId,
      assetIds,
      input.customerAddressId,
    );
    await this.validateTechnicianAssignments(
      organizationId,
      input.businessUnitId,
      input.responsibleFieldTechnicianId,
      input.auxiliaryTechnicianIds ?? [],
    );
    const auxiliares = input.auxiliaryTechnicianIds ?? [];
    try {
      /**
       * A ordem de serviço é a unidade comercial de OS.
       *
       * A cota mensal é cobrada da ordem canônica criada — não de tentativas
       * de renderizar o documento dela, que podem ser muitas para a mesma
       * ordem (§46). A cobrança e a criação estão na mesma transação: se o
       * mês acabou, não sobra ordem criada sem cota.
       */
      /**
       * Escalar alguém não compra licença.
       *
       * A vaga de equipe de campo é cobrada quando a pessoa é **habilitada**
       * para operar, e não quando ela aparece numa ordem: designar o mesmo
       * técnico em dez atendimentos continua sendo uma pessoa. O domínio já
       * exige que todo designado seja um `FIELD_TECHNICIAN` ativo, então quem
       * chega aqui ocupa a sua vaga desde a habilitação.
       */
      const operation = await this.entitlements.guardUsage(
        organizationId,
        UsageResource.SERVICE_ORDERS_CREATED,
        (criada: { id: string }) => ({ type: 'OPERATION', id: criada.id }),
        () =>
          this.repository.create(
            {
              organizationId,
              businessUnitId: input.businessUnitId,
              customerId: input.customerId ?? references.assetCustomerId,
              customerAddressId: input.customerAddressId,
              sector: input.sector,
              code: input.code.trim().toUpperCase(),
              kind: input.kind,
              title: input.title,
              description: input.description,
              status: input.scheduledStart
                ? OperationStatus.SCHEDULED
                : OperationStatus.OPEN,
              priority: input.priority,
              scheduledStart: input.scheduledStart,
              scheduledEnd: input.scheduledEnd,
              location: input.location as Prisma.InputJsonValue | undefined,
              data: input.data as Prisma.InputJsonValue | undefined,
              createdById: actorId,
              responsibleFieldTechnicianId: input.responsibleFieldTechnicianId,
              /* Omitido vira `false` pelo padrão da coluna; explicitar aqui
                 mantém a regra visível no único lugar que a aplica. */
              amountVisibleInField: input.amountVisibleInField ?? false,
            },
            actorId,
            this.json({ code: input.code, title: input.title }),
            auxiliares,
            assetIds,
          ),
      );
      const recipients = [
        input.responsibleFieldTechnicianId,
        ...(input.auxiliaryTechnicianIds ?? []),
      ].filter((value): value is string => Boolean(value));
      for (const recipient of new Set(recipients))
        await this.notifyAssignment(operation, recipient);
      return operation;
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateOperationDto,
  ) {
    if (
      input.responsibleFieldTechnicianId !== undefined ||
      input.auxiliaryTechnicianIds !== undefined
    )
      throw new ValidationException(
        'Use explicit assignment commands to change operation technicians',
      );
    const current = await this.get(id, organizationId);
    const businessUnitId = input.businessUnitId ?? current.businessUnitId;
    const customerId = input.customerId ?? current.customerId ?? undefined;
    const assetIds =
      input.assetIds ?? current.assets.map((link) => link.asset.id);
    const customerAddressId =
      input.customerAddressId ?? current.customerAddressId ?? undefined;
    this.validateSchedule(
      input.scheduledStart ?? current.scheduledStart ?? undefined,
      input.scheduledEnd ?? current.scheduledEnd ?? undefined,
    );
    await this.validateReferences(
      organizationId,
      businessUnitId,
      customerId,
      assetIds,
      customerAddressId,
    );
    try {
      return await this.repository.update(
        id,
        {
          businessUnit: input.businessUnitId
            ? { connect: { id: input.businessUnitId } }
            : undefined,
          customer: input.customerId
            ? { connect: { id: input.customerId } }
            : undefined,
          customerAddress: input.customerAddressId
            ? { connect: { id: input.customerAddressId } }
            : undefined,
          sector: input.sector,
          code: input.code?.trim().toUpperCase(),
          kind: input.kind,
          title: input.title,
          description: input.description,
          priority: input.priority,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          location: input.location as Prisma.InputJsonValue | undefined,
          data: input.data as Prisma.InputJsonValue | undefined,
          /* `undefined` quando o campo não veio: é um `PATCH`, e ausente
             significa "não mexi nisso", não "desligue". */
          amountVisibleInField: input.amountVisibleInField,
        },
        actorId,
        this.json({ changedFields: Object.keys(input) }),
      );
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async changeStatus(
    id: string,
    organizationId: string,
    actorId: string,
    input: ChangeOperationStatusDto,
    permissions?: readonly string[],
  ) {
    const current = await this.get(id, organizationId);
    /**
     * `*` concede tudo — como no `PermissionsGuard` e no `OperationMapper`.
     *
     * Este guarda lia a lista de permissões por igualdade exata, enquanto o
     * mapa de `allowedActions` (corrigido na PR-FE-01) e o próprio
     * `PermissionsGuard` honram o curinga. A mesma lista, dois significados: o
     * Read Model publicava `CHANGE_STATUS` para o dono da organização e este
     * método respondia 403 — o menu enganoso seguido de recusa que a PR-FE-02
     * existe para eliminar.
     *
     * A regra de negócio não muda: quem gerencia a carteira segue podendo, e
     * quem não gerencia segue precisando estar escalado.
     */
    const manages =
      permissions?.includes('*') ||
      permissions?.includes('operations.assign') ||
      permissions?.includes('operations.update');
    if (current.responsibleFieldTechnicianId && permissions && !manages) {
      const assigned =
        current.responsibleFieldTechnicianId === actorId ||
        current.auxiliaryTechnicians.some(
          (assignment) => assignment.userId === actorId,
        );
      if (!assigned)
        throw new ForbiddenException(
          'Operation execution requires assignment and permission',
        );
    }
    const from = current.status;
    if (!OperationStateMachine.allows(from, input.status)) {
      throw new ValidationException(
        `Status transition from ${from} to ${input.status} is not allowed`,
      );
    }
    const now = new Date();
    const result = await this.repository.changeStatus(
      id,
      from,
      input.status,
      {
        status: input.status,
        startedAt:
          input.status === OperationStatus.IN_PROGRESS
            ? (current.startedAt ?? now)
            : undefined,
        startedByUserId:
          input.status === OperationStatus.IN_PROGRESS &&
          !current.startedByUserId
            ? actorId
            : undefined,
        completedAt:
          input.status === OperationStatus.COMPLETED ? now : undefined,
        completedByUserId:
          input.status === OperationStatus.COMPLETED ? actorId : undefined,
      },
      actorId,
      this.json({ reason: input.reason }),
    );
    if (!result) {
      throw new ConflictException(
        'Operation status changed concurrently; reload and try again',
      );
    }
    return result;
  }

  async assign(
    id: string,
    organizationId: string,
    actorId: string,
    input: AssignOperationUserDto,
  ) {
    const operation = await this.get(id, organizationId);
    await this.assertFieldTechnician(
      organizationId,
      operation.businessUnitId,
      input.userId,
    );
    const resultado = operation.responsibleFieldTechnicianId
      ? await this.addAuxiliaryTechnician(
          id,
          organizationId,
          actorId,
          input.userId,
        )
      : await this.replaceResponsibleFieldTechnician(
          id,
          organizationId,
          actorId,
          input.userId,
        );

    /**
     * Sem exigência, atribuir **é** autorizar.
     *
     * Sem este carimbo o recurso teria uma bomba-relógio: um atendimento
     * atribuído hoje, com a chave desligada, nasceria sem autorização — e
     * sumiria da fila do técnico no dia em que alguém ligasse a chave. A
     * organização veria trabalho já distribuído desaparecer sem ninguém ter
     * tocado nele.
     *
     * A migração carimbou o passado pela mesma razão. Isto mantém a promessa
     * daqui para frente: ligar a exigência vale para o que for atribuído
     * **depois**, nunca para o que já estava nas mãos de alguém.
     */
    if (
      resultado.authorizedAt === null &&
      !(await this.requiresAuthorization(organizationId))
    ) {
      return this.repository.setAuthorization(
        id,
        organizationId,
        actorId,
        true,
        /* Sem trilha: não foi decisão, foi a política da organização. */
        false,
      );
    }
    return resultado;
  }

  /**
   * Autoriza a atribuição — ou retira a autorização.
   *
   * ## Só faz sentido onde a organização exige
   *
   * Carimbar um atendimento numa organização que não liga a chave não muda
   * nada e confundiria a trilha: alguém leria "autorizado por" e concluiria
   * que existe uma etapa que ninguém cumpre. A recusa é explícita.
   *
   * ## Revogar tira da fila de quem já a tinha
   *
   * É o ponto do recurso: o dono errou a atribuição, revoga, e o atendimento
   * some do aplicativo do técnico. O que já foi executado fica — revogar não
   * apaga trabalho, só interrompe o que ainda não começou.
   */
  async setAuthorization(
    id: string,
    organizationId: string,
    actorId: string,
    autorizar: boolean,
  ) {
    await this.get(id, organizationId);
    if (!(await this.requiresAuthorization(organizationId))) {
      throw new ValidationException(
        'This organization does not require assignment authorization',
      );
    }
    return this.repository.setAuthorization(
      id,
      organizationId,
      actorId,
      autorizar,
    );
  }

  /**
   * Autoriza várias atribuições numa chamada.
   *
   * ## Por que não é um laço de `setAuthorization`
   *
   * Porque a exigência da organização e a existência de cada operação seriam
   * consultadas uma vez por id: autorizar trinta atendimentos faria sessenta
   * consultas para responder duas perguntas. A exigência é da organização e se lê
   * uma vez; a existência vira uma consulta que confere os trinta juntos.
   *
   * ## Já autorizado não é erro
   *
   * Duas pessoas podem clicar no mesmo botão, e o segundo clique não deve falhar —
   * o estado desejado já é o que está lá. O resultado diz quantos mudaram, que é a
   * pergunta que a tela faz.
   *
   * ## Um id de fora da organização derruba a chamada inteira
   *
   * E não é rigor: autorizar parcialmente e devolver "26 de 30" deixaria o dono sem
   * saber quais quatro ficaram de fora nem por quê. O que não existe aqui é erro de
   * quem chamou, não um caso a tolerar.
   */
  async authorizeMany(
    organizationId: string,
    actorId: string,
    operationIds: readonly string[],
  ): Promise<{ authorized: number }> {
    if (!(await this.requiresAuthorization(organizationId))) {
      throw new ValidationException(
        'This organization does not require assignment authorization',
      );
    }

    const encontrados = await this.repository.findIdsWithin(
      organizationId,
      operationIds,
    );
    if (encontrados.length !== new Set(operationIds).size) {
      throw new EntityNotFoundException('Operation');
    }

    /*
     * Só o que está atribuído é autorizável.
     *
     * Carimbar um atendimento sem responsável liberaria para o campo um trabalho que
     * não é de ninguém — e ele some da fila de pendências sem nunca ter chegado a um
     * técnico.
     */
    const semResponsavel = encontrados.filter(
      (operation) => !operation.responsibleFieldTechnicianId,
    );
    if (semResponsavel.length) {
      throw new ValidationException(
        'Only assigned operations can be authorized: assign a responsible technician first',
      );
    }

    return {
      authorized: await this.repository.authorizeMany(
        organizationId,
        actorId,
        encontrados
          .filter((operation) => operation.authorizedAt === null)
          .map((operation) => operation.id),
      ),
    };
  }

  /** A organização exige autorização depois da atribuição? */
  async requiresAuthorization(organizationId: string): Promise<boolean> {
    return requiresAssignmentAuthorization(
      await this.repository.organizationSettings(organizationId),
    );
  }

  async unassign(
    id: string,
    userId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const operation = await this.get(id, organizationId);
    if (operation.responsibleFieldTechnicianId === userId)
      throw new ValidationException(
        'Responsible field technician must be replaced explicitly',
      );
    const removed = await this.repository.removeAuxiliaryTechnician(
      id,
      organizationId,
      userId,
      actorId,
    );
    if (!removed)
      throw new EntityNotFoundException('Operation auxiliary technician');
  }

  async replaceResponsibleFieldTechnician(
    id: string,
    organizationId: string,
    actorId: string,
    userId: string,
  ) {
    const operation = await this.get(id, organizationId);
    await this.assertFieldTechnician(
      organizationId,
      operation.businessUnitId,
      userId,
    );
    if (operation.responsibleFieldTechnicianId === userId)
      throw new ConflictException(
        'User is already the responsible field technician',
      );
    const result = await this.repository.replaceResponsibleFieldTechnician(
      id,
      organizationId,
      operation.responsibleFieldTechnicianId,
      userId,
      actorId,
    );
    await this.notifyAssignment(result, userId);
    return result;
  }

  async addAuxiliaryTechnician(
    id: string,
    organizationId: string,
    actorId: string,
    userId: string,
  ) {
    const operation = await this.get(id, organizationId);
    if (operation.responsibleFieldTechnicianId === userId)
      throw new ValidationException(
        'Responsible field technician cannot also be an auxiliary technician',
      );
    await this.assertFieldTechnician(
      organizationId,
      operation.businessUnitId,
      userId,
    );
    /** Designação não consome vaga: a pessoa já está habilitada (§24). */
    const result = await this.repository.addAuxiliaryTechnician(
      id,
      organizationId,
      userId,
      actorId,
    );
    if (!result)
      throw new ConflictException('Auxiliary technician is already assigned');
    await this.notifyAssignment(result, userId);
    return result;
  }

  private async notifyAssignment(
    operation: {
      id: string;
      organizationId: string;
      businessUnitId: string;
      updatedAt: Date;
    },
    recipientUserId: string,
  ): Promise<void> {
    if (!this.mobileNotifications) return;
    try {
      await this.mobileNotifications.materialize({
        organizationId: operation.organizationId,
        businessUnitId: operation.businessUnitId,
        recipientUserId,
        type: 'WORK_ASSIGNED',
        factId: `${operation.id}:${operation.updatedAt.toISOString()}`,
        resourceId: operation.id,
        correlationId: generateUuidV7(),
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'mobile_notification_materialization_failed',
          type: 'WORK_ASSIGNED',
          errorClass:
            error instanceof Error ? error.constructor.name : 'Unknown',
        }),
      );
    }
  }

  async removeAuxiliaryTechnician(
    id: string,
    organizationId: string,
    actorId: string,
    userId: string,
  ) {
    await this.get(id, organizationId);
    const result = await this.repository.removeAuxiliaryTechnician(
      id,
      organizationId,
      userId,
      actorId,
    );
    if (!result)
      throw new EntityNotFoundException(
        'Operation auxiliary technician',
        userId,
      );
    return result;
  }

  async history(id: string, organizationId: string) {
    await this.get(id, organizationId);
    return (await this.repository.timeline(id)).history;
  }

  async timeline(id: string, organizationId: string) {
    await this.get(id, organizationId);
    const timeline = await this.repository.timeline(id);
    return {
      events: timeline.history,
      attachments: timeline.attachments.map((attachment) => ({
        id: attachment.id,
        operationId: attachment.operationId,
        uploadedById: attachment.uploadedById,
        uploadedBy: attachment.uploadedBy,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        checksum: attachment.checksum,
        createdAt: attachment.createdAt,
      })),
    };
  }

  async attach(
    id: string,
    organizationId: string,
    actorId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.get(id, organizationId);
    if (!file || file.size === 0) {
      throw new ValidationException('Attachment file is required');
    }
    const stored = await this.storage.store(file);
    try {
      return await this.repository.createAttachment(
        {
          operationId: id,
          uploadedById: actorId,
          fileName: this.fileName(file.originalname),
          mimeType: file.mimetype || 'application/octet-stream',
          size: stored.size,
          storageKey: stored.storageKey,
          checksum: stored.checksum,
        },
        actorId,
      );
    } catch (error) {
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  /**
   * O registro de campo: o que o técnico fotografou e o que o cliente assinou.
   *
   * ## Por que a web precisa disto
   *
   * As fotos e a assinatura eram gravadas pelo aplicativo e só apareciam **dentro
   * do PDF**. Quem acompanha o fluxo pela plataforma não tinha como ver se havia
   * evidência nem se o cliente assinou, a não ser emitindo o documento e abrindo o
   * arquivo — o que só é possível depois de o atendimento acabar.
   *
   * ## As URLs são assinadas na hora
   *
   * O arquivo mora no storage, fora da API, e o acesso a ele é temporário. Assinar
   * na leitura é o que mantém o endereço curto de vida: gravá-lo em algum lugar
   * significaria distribuir um link que continua valendo depois de a pessoa perder
   * o acesso ao atendimento.
   */
  async fieldRecord(
    operationId: string,
    organizationId: string,
  ): Promise<OperationFieldRecordReadModel> {
    /* A leitura da operação primeiro: é ela que confere o inquilino e responde
       "não encontrado" para quem pede o atendimento de outra organização. */
    await this.get(operationId, organizationId);
    const record = await this.repository.fieldRecord(
      operationId,
      organizationId,
    );

    const evidence = await Promise.all(
      record.evidence.map(async (item) => {
        const signed = await this.files.sign(item.storageFile, 'preview');
        return {
          id: item.id,
          category: item.category,
          source: item.source,
          fileName: item.fileName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes.toString(),
          capturedAt: item.capturedAt?.toISOString() ?? null,
          capturedBy: item.capturedBy
            ? {
                id: item.capturedBy.id,
                displayName: item.capturedBy.displayName,
              }
            : null,
          url: signed.url,
          expiresAt: signed.expiresAt.toISOString(),
        };
      }),
    );

    if (!record.acknowledgement) return { evidence, acknowledgement: null };

    const signature = record.signatureFile
      ? await this.files.sign(record.signatureFile, 'preview')
      : null;

    return {
      evidence,
      acknowledgement: {
        id: record.acknowledgement.id,
        signerName: record.acknowledgement.signerName,
        acknowledgedAt: record.acknowledgement.acknowledgedAt.toISOString(),
        capturedBy: record.capturedBy
          ? {
              id: record.capturedBy.id,
              displayName: record.capturedBy.displayName,
            }
          : null,
        signature: signature
          ? {
              url: signature.url,
              expiresAt: signature.expiresAt.toISOString(),
            }
          : null,
        summary: record.acknowledgement.summarySnapshot,
      },
    };
  }

  async download(
    operationId: string,
    attachmentId: string,
    organizationId: string,
  ) {
    await this.get(operationId, organizationId);
    const attachment = await this.repository.findAttachment(
      attachmentId,
      operationId,
    );
    if (!attachment) {
      throw new EntityNotFoundException('Operation attachment', attachmentId);
    }
    return {
      attachment,
      buffer: await this.storage.read(attachment.storageKey),
    };
  }

  async removeAttachment(
    operationId: string,
    attachmentId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    await this.get(operationId, organizationId);
    const attachment = await this.repository.findAttachment(
      attachmentId,
      operationId,
    );
    if (!attachment) {
      throw new EntityNotFoundException('Operation attachment', attachmentId);
    }
    await this.repository.softDeleteAttachment(
      attachmentId,
      operationId,
      actorId,
    );
    await this.storage.remove(attachment.storageKey).catch(() => undefined);
  }

  async remove(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const operation = await this.get(id, organizationId);
    if (operation.status === OperationStatus.IN_PROGRESS) {
      throw new ValidationException(
        'An in-progress operation cannot be deleted',
      );
    }
    await this.repository.softDelete(id, actorId);
  }

  /**
   * Confere unidade, cliente, endereço e equipamentos — e a coerência entre eles.
   *
   * ## O equipamento tem de ser do cliente do atendimento
   *
   * A regra já existia para um equipamento; com a lista ela vale para cada um.
   * Um atendimento que mistura aparelhos de dois clientes mandaria o técnico ao
   * endereço de um para mexer no aparelho do outro.
   *
   * ## O endereço também
   *
   * Endereço é cadastro do cliente. Aceitar o endereço de outro cliente deixaria
   * o técnico com a rota errada e o relatório citando um lugar onde ninguém
   * esteve.
   */
  private async validateReferences(
    organizationId: string,
    businessUnitId: string,
    customerId?: string,
    assetIds: readonly string[] = [],
    customerAddressId?: string,
  ) {
    const unit = await this.repository.findBusinessUnit(
      businessUnitId,
      organizationId,
    );
    if (!unit) throw new ValidationException('Invalid business unit');
    if (customerId) {
      const customer = await this.repository.findCustomer(
        customerId,
        organizationId,
      );
      if (!customer) throw new ValidationException('Invalid customer');
    }

    if (customerAddressId) {
      if (!customerId) {
        throw new ValidationException(
          'A service address requires the customer it belongs to',
        );
      }
      const address = await this.repository.findCustomerAddress(
        customerAddressId,
        organizationId,
      );
      if (!address || address.customerId !== customerId) {
        throw new ValidationException(
          'The service address must belong to the operation customer',
        );
      }
    }

    const unicos = [...new Set(assetIds)];
    if (unicos.length === 0) return { assetCustomerId: undefined };

    const assets = await this.repository.findAssets(
      unicos,
      organizationId,
      businessUnitId,
    );
    if (assets.length !== unicos.length) {
      throw new ValidationException(
        'Every equipment must be available in the operation business unit',
      );
    }
    if (customerId) {
      const alheio = assets.find(
        (asset) => asset.customerId && asset.customerId !== customerId,
      );
      if (alheio) {
        throw new ValidationException('Equipment belongs to another customer');
      }
    }

    /**
     * Sem cliente informado, o do primeiro equipamento vale — desde que todos
     * concordem. Equipamentos de clientes diferentes num atendimento sem
     * cliente não têm dono possível, e adivinhar um seria escolher por sorteio.
     */
    const donos = new Set(
      assets.flatMap((asset) => (asset.customerId ? [asset.customerId] : [])),
    );
    if (!customerId && donos.size > 1) {
      throw new ValidationException(
        'Equipment from different customers requires an explicit customer',
      );
    }
    return { assetCustomerId: [...donos][0] };
  }

  private validateSchedule(start?: Date, end?: Date) {
    if (start && end && end.getTime() < start.getTime()) {
      throw new ValidationException(
        'Scheduled end cannot precede scheduled start',
      );
    }
  }

  private async validateTechnicianAssignments(
    organizationId: string,
    businessUnitId: string,
    responsibleUserId?: string,
    auxiliaryUserIds: readonly string[] = [],
  ) {
    if (responsibleUserId && auxiliaryUserIds.includes(responsibleUserId))
      throw new ValidationException(
        'Responsible field technician cannot also be an auxiliary technician',
      );
    if (!responsibleUserId && auxiliaryUserIds.length)
      throw new ValidationException(
        'Auxiliary technicians require a responsible field technician',
      );
    if (!responsibleUserId && !auxiliaryUserIds.length) return;

    /**
     * O responsável precisa da designação profissional; o auxiliar, não.
     *
     * Antes os dois passavam pelo mesmo filtro de `FIELD_TECHNICIAN`, e a
     * consequência era que o papel "Auxiliar técnico" nunca podia ser auxiliar
     * de nada: a designação de executante era exigida de quem o produto define
     * como observador. Quem decide o que o auxiliar pode fazer no atendimento é
     * `MobileFieldOperationService.isAuxiliaryOnly`, pela atribuição.
     */
    if (responsibleUserId) {
      const executantes = await this.workforce.listProfessionals(
        organizationId,
        'FIELD_TECHNICIAN',
        businessUnitId,
      );
      if (!executantes.some((item) => item.userId === responsibleUserId))
        throw new ValidationException(
          'The responsible technician must be an active FIELD_TECHNICIAN in the operation business unit',
        );
    }

    if (auxiliaryUserIds.length) {
      const acompanhantes = await this.workforce.listFieldAssistantCandidates(
        organizationId,
        businessUnitId,
      );
      const permitidos = new Set(acompanhantes.map((item) => item.userId));
      if (auxiliaryUserIds.some((id) => !permitidos.has(id)))
        throw new ValidationException(
          'Every auxiliary technician must be an active member with field app access in the operation business unit',
        );
    }
  }

  private assertFieldTechnician(
    organizationId: string,
    businessUnitId: string,
    userId: string,
  ) {
    return this.validateTechnicianAssignments(
      organizationId,
      businessUnitId,
      userId,
    );
  }

  private fileName(value: string): string {
    const sanitized = Array.from(value.normalize('NFKC'))
      .map((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 ||
          code === 127 ||
          character === '/' ||
          character === '\\'
          ? '_'
          : character;
      })
      .join('')
      .trim();
    return (sanitized || 'attachment').slice(0, 255);
  }

  private json(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private mapConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Operation code is already in use');
    }
    throw error;
  }
}
