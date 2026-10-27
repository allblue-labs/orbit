import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  CatalogQueryDto,
  CreateProductCategoryDto,
  CreateProductDto,
  UpdateProductCategoryDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('Technical Catalog')
@Controller('catalog')
@RequiresActivePlan()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @Capabilities('catalog.read')
  @Permissions('catalog.read')
  categories(@Req() request: IdentityRequest) {
    return this.catalog.listCategories(this.organizationId(request));
  }

  @Post('categories')
  @Capabilities('catalog.manage')
  @Permissions('catalog.categories.create')
  createCategory(
    @Req() request: IdentityRequest,
    @Body() input: CreateProductCategoryDto,
  ) {
    return this.catalog.createCategory(this.organizationId(request), input);
  }

  @Patch('categories/:id')
  @Capabilities('catalog.manage')
  @Permissions('catalog.categories.update')
  updateCategory(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateProductCategoryDto,
  ) {
    return this.catalog.updateCategory(id, this.organizationId(request), input);
  }

  @Delete('categories/:id')
  @Capabilities('catalog.manage')
  @Permissions('catalog.categories.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCategory(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.catalog.removeCategory(id, this.organizationId(request));
  }

  @Get('products')
  @Capabilities('catalog.read')
  @Permissions('catalog.read')
  products(@Req() request: IdentityRequest, @Query() query: CatalogQueryDto) {
    return this.catalog.listProducts(this.organizationId(request), query);
  }

  @Get('products/:id')
  @Capabilities('catalog.read')
  @Permissions('catalog.read')
  product(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.catalog.getProduct(id, this.organizationId(request));
  }

  @Post('products')
  @Capabilities('catalog.manage')
  @Permissions('catalog.products.create')
  createProduct(
    @Req() request: IdentityRequest,
    @Body() input: CreateProductDto,
  ) {
    return this.catalog.createProduct(
      this.organizationId(request),
      input,
      request.identity,
    );
  }

  @Patch('products/:id')
  @Capabilities('catalog.manage')
  @Permissions('catalog.products.update')
  updateProduct(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(id, this.organizationId(request), input);
  }

  @Delete('products/:id')
  @Capabilities('catalog.manage')
  @Permissions('catalog.products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeProduct(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.catalog.removeProduct(id, this.organizationId(request));
  }

  private organizationId(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }
}
