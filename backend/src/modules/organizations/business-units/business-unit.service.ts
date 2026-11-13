import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../../exceptions';
import { SlugHelper } from '../../../helpers';
import { BrandImageService } from '../../storage/brand-image.service';
import type {
  CreateBusinessUnitDto,
  UpdateBusinessUnitDto,
} from '../dto/organization.dto';
import {
  AllocationResource,
  EntitlementService,
} from '../../subscription-plans/entitlements';
import { BusinessUnitRepository } from './business-unit.repository';

@Injectable()
export class BusinessUnitService {
  constructor(
    private readonly repository: BusinessUnitRepository,
    private readonly entitlements: EntitlementService,
    private readonly brands: BrandImageService,
  ) {}

  list(organizationId: string) {
    return this.repository.list(organizationId);
  }

  async create(
    organizationId: string,
    actorUserId: string,
    accessibleUnitIds: readonly string[],
    input: CreateBusinessUnitDto,
  ) {
    if (input.parentId) {
      await this.require(input.parentId, organizationId);
    }
    const role = await this.repository.findActorRole(
      organizationId,
      actorUserId,
    );
    if (!role) throw new ForbiddenException();
    const slug = SlugHelper.create(input.tradeName ?? input.legalName);
    if (!slug) throw new ValidationException('Unable to generate a valid slug');
    try {
      /**
       * A vaga de unidade é conferida e mantida até o commit: entre a
       * contagem e a inserção não cabe outra requisição.
       */
      return await this.entitlements.guardAllocation(
        organizationId,
        AllocationResource.BUSINESS_UNITS,
        () =>
          this.repository.create(
            organizationId,
            actorUserId,
            accessibleUnitIds,
            role.roleId,
            input,
            slug,
          ),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Business unit name already exists',
          'BUSINESS_UNIT_NAME_ALREADY_EXISTS',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateBusinessUnitDto,
  ) {
    const current = await this.require(id, organizationId);
    if (input.parentId === id) {
      throw new ValidationException('A business unit cannot be its own parent');
    }
    if (input.parentId) {
      await this.require(input.parentId, organizationId);
    }
    if (current.isPrimary && input.isPrimary === false) {
      throw new ConflictException(
        'Promote another business unit instead of unsetting the primary unit',
      );
    }
    const name = input.tradeName ?? input.legalName;
    const slug = name ? SlugHelper.create(name) : undefined;
    try {
      return await this.repository.update(id, organizationId, input, slug);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Business unit conflicts with an existing record',
          'BUSINESS_UNIT_NAME_ALREADY_EXISTS',
        );
      }
      throw error;
    }
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const unit = await this.require(id, organizationId);
    if (unit.isPrimary) {
      throw new ConflictException(
        'The primary business unit cannot be deleted',
      );
    }
    await this.brands.remove(unit.logoUrl, organizationId);
    await this.repository.softDelete(id);
  }

  /**
   * Define a marca da unidade.
   *
   * O que chega é data URI, e `readEmbeddedImage` decide se entra: recusa URL
   * — que o servidor teria de buscar, com o endereço escolhido pelo inquilino
   * — recusa SVG, que carrega script, e limita o tamanho. A mesma função
   * valida na leitura, dentro do gerador de documento; aqui ela impede que o
   * inválido chegue a ser gravado.
   */
  async setLogo(id: string, organizationId: string, image: string) {
    const previous = await this.require(id, organizationId);
    const logoUrl = await this.brands.store(organizationId, id, image);
    try {
      const saved = await this.repository.setLogo(id, logoUrl);
      await this.brands.remove(previous.logoUrl, organizationId);
      return { ...saved, logoUrl: await this.brands.url(saved.logoUrl) };
    } catch (error) {
      const current = await this.repository.find(id, organizationId);
      if (current?.logoUrl !== logoUrl)
        await this.brands.remove(logoUrl, organizationId);
      throw error;
    }
  }
  async removeLogo(id: string, organizationId: string) {
    const previous = await this.require(id, organizationId);
    const saved = await this.repository.setLogo(id, null);
    await this.brands.remove(previous.logoUrl, organizationId);
    return saved;
  }

  private async require(id: string, organizationId: string) {
    const unit = await this.repository.find(id, organizationId);
    if (!unit) throw new EntityNotFoundException('BusinessUnit', id);
    return unit;
  }
}
