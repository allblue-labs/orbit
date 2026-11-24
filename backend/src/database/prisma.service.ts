/**
 * Production connects through DATABASE_URL and validates the connected role.
 * APP_DATABASE_URL remains a development and integration-test alias.
 * Migration and bootstrap jobs use their own administrative client.
 */
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { EnvironmentProvider } from '../providers';

interface RolePrivileges {
  role: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  privileged_membership: boolean;
  owns_application_objects: boolean;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly environment: EnvironmentProvider) {
    const number = (key: string, fallback: number): number => {
      const parsed = Number(environment.getOptional(key));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    super({
      adapter: new PrismaPg({
        connectionString:
          environment.getOptional('NODE_ENV') === 'production'
            ? environment.get('DATABASE_URL')
            : environment.getOptional('APP_DATABASE_URL')?.trim() ||
              environment.get('DATABASE_URL'),
        /**
         * O padrão do `pg` é 10 conexões — e 10 é pouco quando HTTP e worker
         * dividem o mesmo processo. Uma transação interativa **segura** a
         * conexão do começo ao fim; com o pool no limite, quem chega espera, e
         * o relógio do tempo limite da transação já está correndo.
         */
        max: number('DATABASE_POOL_MAX', 12),
        application_name: `orbit-${environment.getOptional('ORBIT_PROCESS_ROLE') || 'combined'}`,
        connectionTimeoutMillis: 5_000,
      }),
      /**
       * Janela da transação interativa.
       *
       * O padrão do Prisma é 5 s, contados do `BEGIN`. Isso pressupõe um laço
       * de eventos livre — e o Orbit renderiza PDF em processo, o que o prende
       * por vezes. Uma transação curta e correta expirava por causa de trabalho
       * alheio, e o erro aparecia como falha genérica em outra rota.
       *
       * Aumentar a janela **não** é desculpa para transação longa: as regras de
       * escopo continuam as mesmas, e o `docs/rls-and-worker-context.md`
       * descreve o que pode e o que não pode acontecer dentro de uma.
       */
      transactionOptions: {
        timeout: number('DATABASE_TRANSACTION_TIMEOUT_MS', 20_000),
        maxWait: number('DATABASE_TRANSACTION_MAX_WAIT_MS', 10_000),
      },
    });
  }

  /**
   * Confere o papel de runtime assim que há conexão.
   *
   * Roda no `onModuleInit` do Nest — antes de qualquer requisição ser atendida,
   * e cedo o bastante para que a recusa aconteça na subida, não no primeiro
   * vazamento.
   */
  async onModuleInit(): Promise<void> {
    const [privileges] = await this.$queryRaw<RolePrivileges[]>`
      SELECT current_user::text AS role, rolsuper, rolbypassrls,
             rolcreatedb, rolcreaterole, rolreplication,
             EXISTS (
               SELECT 1 FROM pg_roles parent
                WHERE parent.oid <> runtime.oid
                  AND pg_has_role(current_user, parent.oid, 'MEMBER')
                  AND (parent.rolsuper OR parent.rolbypassrls OR
                       parent.rolcreatedb OR parent.rolcreaterole OR
                       parent.rolreplication OR parent.rolname IN (
                         'pg_read_all_data', 'pg_write_all_data',
                         'pg_read_server_files', 'pg_write_server_files',
                         'pg_execute_server_program', 'pg_signal_backend',
                         'pg_checkpoint', 'pg_create_subscription',
                         'pg_maintain', 'pg_use_reserved_connections'
                       ))
             ) AS privileged_membership,
             (
               EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database()
                        AND pg_has_role(current_user, datdba, 'MEMBER')) OR
               EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public'
                        AND pg_has_role(current_user, nspowner, 'MEMBER')) OR
               EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public'
                          AND pg_has_role(current_user, c.relowner, 'MEMBER'))
             ) AS owns_application_objects
        FROM pg_roles runtime
       WHERE rolname = current_user
    `;

    const enforce =
      this.environment.getOptional('NODE_ENV') === 'production' ||
      this.environment
        .getOptional('DATABASE_ENFORCE_RESTRICTED_ROLE')
        ?.trim() === 'true';
    if (!privileges) {
      if (enforce)
        throw new Error(
          'Não foi possível verificar o papel restrito do banco.',
        );
      this.logger.warn('Não foi possível verificar o papel restrito do banco.');
      return;
    }

    const unsafe = Object.entries(privileges).some(
      ([key, value]) => key !== 'role' && value === true,
    );
    const detail = JSON.stringify({
      stage: 'database-role',
      ...privileges,
      restrictedRole: !unsafe,
    });
    if (!unsafe) {
      this.logger.log(detail);
      return;
    }
    const message = `O papel de runtime possui privilégios administrativos ou ownership indevido. ${detail}`;
    if (enforce) throw new Error(message);
    this.logger.warn(message);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
