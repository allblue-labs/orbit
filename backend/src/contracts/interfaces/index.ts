import type { Cursor, Nullable, SortDirection, UUID } from '../types';

export interface IEntity {
  id: UUID;
}

export interface IAuditable {
  createdAt: Date;
  updatedAt: Date;
}

export interface ISoftDelete {
  deletedAt: Nullable<Date>;
}

export interface IOrganizationScoped {
  organizationId: UUID;
}

export interface IBusinessUnitScoped extends IOrganizationScoped {
  businessUnitId: UUID;
}

export interface IAuthenticatedUser {
  id: UUID;
  roles: readonly string[];
  permissions: readonly string[];
  businessUnitIds: readonly UUID[];
  allowedSurfaces: readonly string[];
  isOrganizationOwner: boolean;
}

export type ActorType =
  | 'ANONYMOUS'
  | 'INTERNAL_USER'
  | 'CUSTOMER_PORTAL'
  | 'CUSTOMER_PORTAL_AUTH'
  | 'SYSTEM';

export interface IRequestContext {
  requestId: string;
  actorType: ActorType;
  userId: Nullable<UUID>;
  portalIdentityId: Nullable<UUID>;
  organizationId: Nullable<UUID>;
  customerId: Nullable<UUID>;
  businessUnitId: Nullable<UUID>;
  businessUnitIds: readonly UUID[];
  roles: readonly string[];
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
  isOrganizationOwner: boolean;
  ip: Nullable<string>;
  userAgent: Nullable<string>;
  locale: string;
}

export interface IPagination {
  page: number;
  limit: number;
}

export interface ICursorPagination {
  cursor?: Cursor;
  limit: number;
}

export interface IPaginatedResult<T> {
  data: readonly T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface ICursorResult<T> {
  data: readonly T[];
  nextCursor: Nullable<Cursor>;
  hasNextPage: boolean;
}

export interface IFilter {
  field: string;
  operator: string;
  value: unknown;
}

export interface ISort {
  field: string;
  direction: SortDirection;
}

export interface IRepository<T extends IEntity> {
  findById(id: UUID): Promise<Nullable<T>>;
  exists(id: UUID): Promise<boolean>;
}

export interface ICrudRepository<
  T extends IEntity,
  TCreate,
  TUpdate,
> extends IRepository<T> {
  findMany(options?: IRepositoryQuery): Promise<readonly T[]>;
  create(data: TCreate): Promise<T>;
  update(id: UUID, data: TUpdate): Promise<T>;
  delete(id: UUID): Promise<void>;
}

export interface IRepositoryQuery {
  filters?: readonly IFilter[];
  sort?: readonly ISort[];
  pagination?: IPagination;
  includeDeleted?: boolean;
}

export interface IBaseResponse<T> {
  success: boolean;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface IClock {
  now(): Date;
}

export interface IUuidProvider {
  generate(): UUID;
}

export interface IHashProvider {
  hash(value: string): Promise<string>;
  verify(hash: string, value: string): Promise<boolean>;
}

export interface ICryptoProvider {
  encrypt(value: string): string;
  decrypt(value: string): string;
  randomBytes(size: number): Buffer;
}

export interface IEnvironmentProvider {
  get(key: string): string;
  getOptional(key: string): string | undefined;
}

export interface ITransactionManager<TTransaction = unknown> {
  run<T>(work: (transaction: TTransaction) => Promise<T>): Promise<T>;
}
