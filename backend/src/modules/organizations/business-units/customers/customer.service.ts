import { Injectable } from '@nestjs/common';
import { enderecoDeAtendimento } from './customer-address-seed';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../../../exceptions';
import type {
  CreateContactDto,
  CreateCustomerAddressDto,
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateContactDto,
  UpdateCustomerAddressDto,
  UpdateCustomerDto,
} from './customer.dto';
import {
  AllocationResource,
  EntitlementService,
} from '../../../subscription-plans/entitlements';
import { CustomerRepository } from './customer.repository';

@Injectable()
export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly entitlements: EntitlementService,
  ) {}

  list(organizationId: string, query: CustomerQueryDto) {
    return this.repository.list(organizationId, query);
  }

  async get(id: string, organizationId: string) {
    const customer = await this.repository.find(id, organizationId);
    if (!customer) throw new EntityNotFoundException('Customer', id);
    return customer;
  }

  async create(organizationId: string, input: CreateCustomerDto) {
    this.validateDocument(input.documentType, input.documentNumber);
    try {
      return await this.entitlements.guardAllocation(
        organizationId,
        AllocationResource.ACTIVE_CUSTOMERS,
        () =>
          this.repository.create(
            {
              organizationId,
              type: input.type,
              legalName: input.legalName,
              tradeName: input.tradeName,
              documentType: input.documentType,
              documentNumber: this.document(input.documentNumber),
              email: input.email?.toLowerCase(),
              phone: input.phone,
              notes: input.notes,
              address: input.address as Prisma.InputJsonValue | undefined,
            },
            /* O mesmo endereço, agora também como destino do técnico. Ver
               `customer-address-seed`. */
            enderecoDeAtendimento(input.address),
          ),
      );
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async update(id: string, organizationId: string, input: UpdateCustomerDto) {
    const current = await this.get(id, organizationId);
    this.validateDocument(
      input.documentType ?? current.documentType ?? undefined,
      input.documentNumber ?? current.documentNumber ?? undefined,
    );
    try {
      return await this.repository.update(id, {
        type: input.type,
        legalName: input.legalName,
        tradeName: input.tradeName,
        documentType: input.documentType,
        documentNumber: this.document(input.documentNumber),
        email: input.email?.toLowerCase(),
        phone: input.phone,
        notes: input.notes,
        address: input.address as Prisma.InputJsonValue | undefined,
        status: input.status,
      });
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.get(id, organizationId);
    await this.repository.softDelete(id);
  }

  /* ---------------------------------------------------------------- */
  /* Endereços de atendimento                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Os endereços de atendimento do cliente.
   *
   * `Customer.address` continua sendo o endereço **fiscal** — o que vai na nota.
   * Isto aqui é para onde o técnico vai, e uma rede com três lojas tem três.
   */
  async listAddresses(
    customerId: string,
    organizationId: string,
    onlyActive = false,
  ) {
    await this.get(customerId, organizationId);
    return this.repository.listAddresses(customerId, onlyActive);
  }

  async createAddress(
    customerId: string,
    organizationId: string,
    input: CreateCustomerAddressDto,
  ) {
    await this.get(customerId, organizationId);
    return this.repository.createAddress({
      organizationId,
      customerId,
      label: input.label,
      street: input.street,
      city: input.city,
      number: input.number,
      complement: input.complement,
      district: input.district,
      stateCode: input.stateCode?.toUpperCase(),
      postalCode: input.postalCode?.replace(/\D/g, ''),
      notes: input.notes,
      isPrimary: input.isPrimary,
    });
  }

  async updateAddress(
    id: string,
    customerId: string,
    organizationId: string,
    input: UpdateCustomerAddressDto,
  ) {
    await this.get(customerId, organizationId);
    const atual = await this.repository.findAddress(id, customerId);
    if (!atual) throw new EntityNotFoundException('CustomerAddress', id);
    return this.repository.updateAddress(id, customerId, {
      label: input.label,
      street: input.street,
      city: input.city,
      number: input.number,
      complement: input.complement,
      district: input.district,
      stateCode: input.stateCode?.toUpperCase(),
      postalCode: input.postalCode?.replace(/\D/g, ''),
      notes: input.notes,
      isPrimary: input.isPrimary,
      isActive: input.isActive,
    });
  }

  async removeAddress(id: string, customerId: string, organizationId: string) {
    await this.get(customerId, organizationId);
    const atual = await this.repository.findAddress(id, customerId);
    if (!atual) throw new EntityNotFoundException('CustomerAddress', id);
    await this.repository.softDeleteAddress(id);
  }

  async listContacts(customerId: string, organizationId: string) {
    await this.get(customerId, organizationId);
    return this.repository.listContacts(customerId);
  }

  async createContact(
    customerId: string,
    organizationId: string,
    input: CreateContactDto,
  ) {
    await this.get(customerId, organizationId);
    await this.validateBusinessUnit(input.businessUnitId, organizationId);
    try {
      return await this.repository.createContact({
        organizationId,
        customerId,
        businessUnitId: input.businessUnitId,
        name: input.name,
        role: input.role,
        email: input.email?.toLowerCase(),
        phone: input.phone,
        isPrimary: input.isPrimary,
      });
    } catch (error) {
      this.mapContactConflict(error);
    }
  }

  async updateContact(
    id: string,
    customerId: string,
    organizationId: string,
    input: UpdateContactDto,
  ) {
    await this.getContact(id, customerId, organizationId);
    await this.validateBusinessUnit(input.businessUnitId, organizationId);
    try {
      return await this.repository.updateContact(
        id,
        customerId,
        organizationId,
        {
          businessUnit: input.businessUnitId
            ? { connect: { id: input.businessUnitId } }
            : undefined,
          name: input.name,
          role: input.role,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          isPrimary: input.isPrimary,
        },
      );
    } catch (error) {
      this.mapContactConflict(error);
    }
  }

  async removeContact(
    id: string,
    customerId: string,
    organizationId: string,
  ): Promise<void> {
    await this.getContact(id, customerId, organizationId);
    await this.repository.softDeleteContact(id);
  }

  private async getContact(
    id: string,
    customerId: string,
    organizationId: string,
  ) {
    const contact = await this.repository.findContact(
      id,
      customerId,
      organizationId,
    );
    if (!contact) throw new EntityNotFoundException('Contact', id);
    return contact;
  }

  private async validateBusinessUnit(
    businessUnitId: string | undefined,
    organizationId: string,
  ) {
    if (!businessUnitId) return;
    const unit = await this.repository.findBusinessUnit(
      businessUnitId,
      organizationId,
    );
    if (!unit) throw new ValidationException('Invalid business unit');
  }

  private validateDocument(type?: string, number?: string) {
    if (Boolean(type) !== Boolean(number)) {
      throw new ValidationException(
        'Document type and number must be provided together',
      );
    }
  }

  private document(value?: string) {
    return value?.replace(/\D/g, '');
  }

  private mapConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Customer document is already registered',
        'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
      );
    }
    throw error;
  }

  private mapContactConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'The customer already has a primary contact',
        'CUSTOMER_PRIMARY_CONTACT_ALREADY_EXISTS',
      );
    }
    throw error;
  }
}
