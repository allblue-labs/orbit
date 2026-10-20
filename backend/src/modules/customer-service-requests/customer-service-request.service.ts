import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import type { CustomerPortalActor } from '../customer-portal/customer-portal.types';
import type {
  AssignCustomerServiceRequestDto,
  ChangeCustomerServiceRequestStatusDto,
  CreateCustomerServiceRequestDto,
  CustomerServiceRequestInternalQueryDto,
  CustomerServiceRequestMessageDto,
  CustomerServiceRequestPortalQueryDto,
  ConvertCustomerServiceRequestDto,
  ExpectedVersionDto,
  TriageCustomerServiceRequestDto,
} from './customer-service-request.dto';
import { CustomerServiceRequestMapper } from './customer-service-request.mapper';
import { CustomerServiceRequestRepository } from './customer-service-request.repository';
import type { InternalCustomerServiceRequestActor } from './customer-service-request.types';

@Injectable()
export class CustomerServiceRequestService {
  constructor(
    private readonly repository: CustomerServiceRequestRepository,
    private readonly mapper: CustomerServiceRequestMapper,
  ) {}

  async portalList(
    actor: CustomerPortalActor,
    query: CustomerServiceRequestPortalQueryDto,
  ) {
    return this.mapper.page(
      await this.repository.portalList(actor, query),
      'PORTAL',
    );
  }

  async portalGet(actor: CustomerPortalActor, id: string) {
    const request = await this.repository.findPortal(actor, id);
    if (!request)
      throw new EntityNotFoundException('Customer service request', id);
    return this.mapper.details(request, 'PORTAL');
  }

  async portalCreate(
    actor: CustomerPortalActor,
    key: string | undefined,
    input: CreateCustomerServiceRequestDto,
  ) {
    const idempotencyKey = this.idempotencyKey(key);
    const request = await this.repository.createPortal(
      actor,
      input,
      idempotencyKey,
      this.hash({
        category: input.category,
        subject: input.subject,
        description: input.description,
        assetId: input.assetId ?? null,
      }),
    );
    return this.mapper.details(request, 'PORTAL');
  }

  async portalCancel(
    actor: CustomerPortalActor,
    id: string,
    input: ExpectedVersionDto,
  ) {
    return this.mapper.details(
      await this.repository.cancelPortal(actor, id, input.expectedVersion),
      'PORTAL',
    );
  }

  async internalList(
    actor: InternalCustomerServiceRequestActor,
    query: CustomerServiceRequestInternalQueryDto,
  ) {
    return this.mapper.page(
      await this.repository.internalList(actor, query),
      'INTERNAL',
    );
  }

  async internalGet(actor: InternalCustomerServiceRequestActor, id: string) {
    const request = await this.repository.findInternal(actor, id);
    if (!request)
      throw new EntityNotFoundException('Customer service request', id);
    return this.mapper.details(request, 'INTERNAL');
  }

  async changeStatus(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    input: ChangeCustomerServiceRequestStatusDto,
  ) {
    return this.mapper.details(
      await this.repository.changeStatus(
        actor,
        id,
        input.expectedVersion,
        input.status,
        input.message,
      ),
      'INTERNAL',
    );
  }

  async triage(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    input: TriageCustomerServiceRequestDto,
  ) {
    return this.mapper.details(
      await this.repository.triage(actor, id, input.expectedVersion, input),
      'INTERNAL',
    );
  }

  async assign(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    input: AssignCustomerServiceRequestDto,
  ) {
    return this.mapper.details(
      await this.repository.assign(
        actor,
        id,
        input.expectedVersion,
        input.userId,
      ),
      'INTERNAL',
    );
  }

  async addMessage(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    input: CustomerServiceRequestMessageDto,
    visibility: 'PORTAL' | 'INTERNAL',
  ) {
    return this.mapper.details(
      await this.repository.addMessage(
        actor,
        id,
        input.expectedVersion,
        input.message,
        visibility,
      ),
      'INTERNAL',
    );
  }

  async convert(
    actor: InternalCustomerServiceRequestActor,
    id: string,
    key: string | undefined,
    input: ConvertCustomerServiceRequestDto,
  ) {
    const idempotencyKey = this.idempotencyKey(key);
    return this.mapper.details(
      await this.repository.convert(
        actor,
        id,
        input,
        idempotencyKey,
        this.hash(input),
      ),
      'INTERNAL',
    );
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value || !/^[A-Za-z0-9._:-]{8,160}$/.test(value)) {
      throw new ValidationException(
        'Idempotency-Key must contain 8 to 160 safe characters',
      );
    }
    return value;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(this.canonical(value)).digest('hex');
  }

  private canonical(value: unknown): string {
    const normalize = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(normalize);
      if (item && typeof item === 'object') {
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, normalize(child)]),
        );
      }
      return item;
    };
    return JSON.stringify(normalize(value));
  }
}
