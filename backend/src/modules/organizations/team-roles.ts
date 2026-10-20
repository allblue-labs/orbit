/** Server-owned RBAC presets and the permission catalogue shown by the UI. */

export const ROLE_SURFACES = ['WEB', 'MOBILE', 'API'] as const;
export type RoleSurface = (typeof ROLE_SURFACES)[number];
export const DEFAULT_ROLE_SURFACES: readonly RoleSurface[] = ['WEB', 'MOBILE'];
export const FIELD_ONLY_SURFACES: readonly RoleSurface[] = ['MOBILE'];

export interface PermissionDefinition {
  readonly code: string;
  readonly label: string;
}
export interface PermissionGroup {
  readonly key: string;
  readonly label: string;
  readonly permissions: readonly PermissionDefinition[];
}

const permission = (code: string, label: string): PermissionDefinition => ({
  code,
  label,
});

/**
 * Codes intentionally match current controller decorators. Custom access may
 * choose from this catalogue, but cannot introduce arbitrary strings or `*`.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: 'customers',
    label: 'Clientes e contatos',
    permissions: [
      permission('customers.read', 'Visualizar clientes'),
      permission('customers.create', 'Cadastrar clientes'),
      permission('customers.update', 'Editar clientes'),
      permission('customers.delete', 'Excluir clientes'),
      permission('contacts.read', 'Visualizar contatos'),
      permission('contacts.create', 'Cadastrar contatos'),
      permission('contacts.update', 'Editar contatos'),
      permission('contacts.delete', 'Excluir contatos'),
    ],
  },
  {
    key: 'equipment',
    label: 'Equipamentos e catálogo',
    permissions: [
      permission('assets.read', 'Visualizar equipamentos'),
      permission('assets.create', 'Cadastrar equipamentos'),
      permission('assets.update', 'Editar equipamentos'),
      permission('assets.delete', 'Excluir equipamentos'),
      permission('assets.qr.manage', 'Gerenciar QR de equipamentos'),
      permission('catalog.read', 'Visualizar catálogo'),
      permission('catalog.categories.create', 'Cadastrar categorias'),
      permission('catalog.categories.update', 'Editar categorias'),
      permission('catalog.categories.delete', 'Excluir categorias'),
      permission('catalog.products.create', 'Cadastrar produtos'),
      permission('catalog.products.update', 'Editar produtos'),
      permission('catalog.products.delete', 'Excluir produtos'),
    ],
  },
  {
    key: 'operations',
    label: 'Atendimentos',
    permissions: [
      permission('operations.read', 'Visualizar atendimentos'),
      permission('operations.create', 'Criar atendimentos'),
      permission('operations.update', 'Editar atendimentos'),
      permission('operations.status.update', 'Alterar etapa do atendimento'),
      permission('operations.assign', 'Atribuir equipe'),
      permission('operations.delete', 'Excluir atendimentos'),
      permission('operations.history.read', 'Visualizar histórico'),
      permission('operations.attachments.read', 'Visualizar evidências'),
      permission('operations.attachments.create', 'Registrar evidências'),
      permission('operations.attachments.delete', 'Excluir evidências'),
      permission('checklists.read', 'Visualizar checklists'),
      permission('checklists.create', 'Criar checklists'),
      permission('checklists.execute', 'Executar checklists'),
      permission('checklists.update', 'Editar execução de checklist'),
      permission('checklists.delete', 'Excluir checklists'),
    ],
  },
  {
    key: 'scheduling',
    label: 'Agenda',
    permissions: [
      permission('scheduling.read', 'Visualizar agenda'),
      permission('scheduling.calendars.create', 'Criar calendários'),
      permission('scheduling.calendars.update', 'Editar calendários'),
      permission('scheduling.calendars.delete', 'Excluir calendários'),
      permission('scheduling.events.create', 'Criar eventos'),
      permission('scheduling.events.update', 'Editar eventos'),
      permission('scheduling.events.delete', 'Excluir eventos'),
      permission('scheduling.allocations.manage', 'Gerenciar alocações'),
      permission('scheduling.availability.manage', 'Gerenciar disponibilidade'),
      permission(
        'scheduling.intelligence.read',
        'Consultar inteligência de agenda',
      ),
    ],
  },
  {
    key: 'technical',
    label: 'PMOC e RVT',
    permissions: [
      permission('pmoc.read', 'Visualizar PMOC'),
      permission('pmoc.manage', 'Gerenciar PMOC'),
      /*
       * Executar em campo é diferente de gerenciar.
       *
       * `pmoc.manage` é do contrato: criar plano, cobrir equipamento, encerrar.
       * `pmoc.execute` é da manutenção: o técnico que vai ao local e atende o
       * aparelho que lhe foi atribuído. O RVT sempre teve as três; o PMOC tinha
       * só as duas primeiras, e a consequência era concreta — o aplicativo de
       * campo verificava `pmoc.execute` em quatro lugares e **nenhum papel a
       * concedia**, então executar PMOC no celular era inalcançável para
       * qualquer técnico. Só o dono passava, por ter o curinga.
       */
      permission('pmoc.execute', 'Executar PMOC em campo'),
      permission('rvt.read', 'Visualizar RVT'),
      permission('rvt.manage', 'Gerenciar RVT'),
      permission('rvt.execute', 'Executar RVT'),
      permission('rvt.document', 'Emitir documento RVT'),
    ],
  },
  {
    key: 'documents',
    label: 'Documentos e assinaturas',
    permissions: [
      permission('reports.read', 'Visualizar relatórios'),
      permission('reports.create', 'Criar relatórios'),
      permission('reports.update', 'Editar relatórios'),
      permission('reports.delete', 'Excluir relatórios'),
      permission('reports.status.update', 'Alterar etapa de relatórios'),
      permission('reports.finalize', 'Finalizar relatórios'),
      permission('reports.render', 'Gerar documentos'),
      permission('reports.documents.read', 'Visualizar documentos'),
      permission(
        'artifact_executions.read',
        'Visualizar execuções documentais',
      ),
      permission('artifact_executions.create', 'Criar execuções documentais'),
      permission('artifact_executions.execute', 'Executar documentos'),
      permission('artifact_executions.update', 'Editar execuções documentais'),
      permission('artifact_manifests.read', 'Visualizar manifestos'),
      permission('artifact_manifests.issue', 'Emitir manifestos'),
      permission('artifact_manifests.revoke', 'Revogar manifestos'),
      permission('artifact_rendering.render', 'Renderizar artefatos'),
      permission('artifact_templates.read', 'Visualizar templates de artefato'),
      permission('artifact_templates.create', 'Criar templates de artefato'),
      permission('artifact_templates.update', 'Editar templates de artefato'),
      permission('artifact_templates.delete', 'Excluir templates de artefato'),
      permission('report_templates.read', 'Visualizar templates de relatório'),
      permission('report_templates.create', 'Criar templates de relatório'),
      permission('report_templates.update', 'Editar templates de relatório'),
      permission('report_templates.delete', 'Excluir templates de relatório'),
      permission('signatures.read', 'Visualizar assinaturas'),
      permission('signatures.create', 'Cadastrar própria assinatura'),
      permission('signatures.revoke', 'Revogar assinaturas'),
    ],
  },
  {
    key: 'commercial',
    label: 'Comercial, estoque e financeiro',
    permissions: [
      permission('quotes.read', 'Visualizar propostas'),
      permission('quotes.manage', 'Gerenciar propostas'),
      permission('inventory.read', 'Visualizar estoque'),
      permission('inventory.manage', 'Gerenciar estoque'),
      permission('financial.read', 'Visualizar financeiro'),
      permission('financial.manage', 'Gerenciar financeiro'),
    ],
  },
  {
    key: 'management',
    label: 'Gestão e configurações',
    permissions: [
      permission('dashboard.read', 'Visualizar painel'),
      permission('analytics.read', 'Visualizar análises'),
      permission('organization.read', 'Visualizar organização'),
      permission('organization.update', 'Editar organização'),
      permission('organization.members.update', 'Gerenciar usuários'),
      permission('organization.roles.manage', 'Gerenciar papéis'),
      permission(
        'customer_service_requests.read',
        'Visualizar solicitações de clientes',
      ),
      permission(
        'customer_service_requests.manage',
        'Gerenciar solicitações de clientes',
      ),
      permission('business_units.create', 'Cadastrar unidades'),
      permission('business_units.update', 'Editar unidades'),
      permission('business_units.delete', 'Excluir unidades'),
      permission('identity.invitations.create', 'Convidar usuários'),
      permission('subscription.manage', 'Gerenciar assinatura'),
      permission('usage.read', 'Visualizar uso do plano'),
      permission('usage.manage', 'Registrar uso do plano'),
      permission('integrations.read', 'Visualizar integrações'),
      permission('integrations.create', 'Criar integrações'),
      permission('integrations.update', 'Editar integrações'),
      permission('integrations.delete', 'Excluir integrações'),
      permission('integrations.validate', 'Validar integrações'),
      permission('automations.read', 'Visualizar automações'),
      permission('automations.manage', 'Gerenciar automações'),
      permission('notifications.read', 'Visualizar notificações'),
      permission('notifications.create', 'Criar notificações'),
      permission('notifications.dispatch', 'Disparar notificações'),
      permission('reports.management.read', 'Visualizar relatórios gerenciais'),
      permission(
        'reports.management.manage',
        'Gerenciar relatórios gerenciais',
      ),
    ],
  },
  {
    key: 'intelligence',
    label: 'Orbit Intelligence',
    permissions: [
      permission('ai.agents.read', 'Visualizar assistentes'),
      permission('ai.agents.create', 'Criar assistentes'),
      permission('ai.agents.update', 'Editar assistentes'),
      permission('ai.agents.delete', 'Excluir assistentes'),
      permission('ai.executions.read', 'Visualizar análises de IA'),
      permission('ai.executions.create', 'Executar análises de IA'),
      permission('ai.executions.cancel', 'Cancelar análises de IA'),
    ],
  },
];

export const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((item) => item.code),
  ),
);

const codes = (...groups: string[]): string[] =>
  PERMISSION_GROUPS.filter((group) => groups.includes(group.key)).flatMap(
    (group) => group.permissions.map((item) => item.code),
  );
const pick = (...values: string[]): string[] => values;

export interface TeamRoleSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly allowedSurfaces: readonly RoleSurface[];
}

export const OWNER_ROLE_KEY = 'OWNER';
export const ADMINISTRATOR_ROLE_KEY = 'ADMINISTRATOR';
export const FIELD_TECHNICIAN_ROLE_KEY = 'FIELD_TECHNICIAN';
export const ASSISTANT_TECHNICIAN_ROLE_KEY = 'ASSISTANT_TECHNICIAN';
export const TECHNICAL_RESPONSIBLE_ROLE_KEY = 'TECHNICAL_RESPONSIBLE';
export const CUSTOMER_SERVICE_ROLE_KEY = 'CUSTOMER_SERVICE';
export const FINANCIAL_ROLE_KEY = 'FINANCIAL';
export const VIEWER_ROLE_KEY = 'VIEWER';

const FIELD_READ = pick(
  'operations.read',
  'operations.attachments.read',
  'operations.history.read',
  'customers.read',
  'contacts.read',
  'assets.read',
  'checklists.read',
  'scheduling.read',
  'inventory.read',
  'catalog.read',
  'pmoc.read',
  'rvt.read',
  'reports.read',
  'reports.documents.read',
  'artifact_executions.read',
  'artifact_manifests.read',
  'notifications.read',
  'signatures.read',
  'signatures.create',
);

export const ASSIGNABLE_TEAM_ROLES: readonly TeamRoleSeed[] = [
  {
    key: ADMINISTRATOR_ROLE_KEY,
    name: 'Administrador',
    description:
      'Administra a operação, pessoas e configurações sem assumir a propriedade da organização.',
    permissions: codes(
      'customers',
      'equipment',
      'operations',
      'scheduling',
      'technical',
      'documents',
      'commercial',
      'management',
      'intelligence',
    ),
    allowedSurfaces: ['WEB', 'MOBILE'],
  },
  {
    key: FIELD_TECHNICIAN_ROLE_KEY,
    /*
     * "Técnico Operacional", e não "Técnico operador".
     *
     * O produto tinha três expressões para dois papéis — "Técnico em Campo",
     * "Técnico responsável" e "Responsável Técnico" —, as duas últimas usando as
     * mesmas palavras em ordens diferentes para dizer coisas opostas. Num PMOC a
     * diferença é concreta: um vai ao local, o outro responde pelo contrato e assina
     * com a credencial que a norma exige.
     *
     * O nome aqui é o do papel de acesso, e ele se alinha ao do papel profissional
     * (`registry/professional`) porque é o mesmo nome que a pessoa lê nos dois
     * lugares. O `key` não muda — é ele que o código e as permissões usam.
     */
    name: 'Técnico Operacional',
    description:
      'Executa o serviço no cliente: atendimento, roteiro, evidências e materiais.',
    permissions: [
      ...FIELD_READ,
      'operations.update',
      'operations.status.update',
      'operations.attachments.create',
      'checklists.execute',
      'checklists.update',
      'inventory.manage',
      'pmoc.execute',
      'rvt.execute',
      'rvt.document',
      'artifact_executions.create',
      'artifact_executions.execute',
      'artifact_executions.update',
      'artifact_manifests.issue',
      'artifact_rendering.render',
      'reports.create',
      'reports.update',
      'reports.status.update',
      'reports.finalize',
      'reports.render',
    ],
    allowedSurfaces: FIELD_ONLY_SURFACES,
  },
  {
    key: ASSISTANT_TECHNICIAN_ROLE_KEY,
    name: 'Auxiliar técnico',
    description:
      'Acompanha atendimentos atribuídos e participa das execuções permitidas.',
    permissions: FIELD_READ,
    allowedSurfaces: FIELD_ONLY_SURFACES,
  },
  {
    key: TECHNICAL_RESPONSIBLE_ROLE_KEY,
    name: 'Responsável técnico',
    description:
      'Revisa PMOC, RVT, assinaturas e documentação técnica sem administrar usuários.',
    permissions: [...FIELD_READ, ...codes('technical', 'documents')],
    allowedSurfaces: ['WEB', 'MOBILE'],
  },
  {
    key: CUSTOMER_SERVICE_ROLE_KEY,
    name: 'Atendimento',
    description:
      'Atende clientes, organiza agenda e acompanha ordens de serviço.',
    permissions: [
      ...codes('customers'),
      'assets.read',
      'operations.read',
      'operations.create',
      'operations.update',
      'operations.assign',
      'scheduling.read',
      'scheduling.events.create',
      'scheduling.events.update',
      'quotes.read',
    ],
    allowedSurfaces: ['WEB'],
  },
  {
    key: FINANCIAL_ROLE_KEY,
    name: 'Financeiro',
    description:
      'Gerencia financeiro, propostas e os documentos comerciais relacionados.',
    permissions: [
      ...codes('commercial'),
      'customers.read',
      'reports.read',
      'reports.documents.read',
      'dashboard.read',
    ],
    allowedSurfaces: ['WEB'],
  },
  {
    key: VIEWER_ROLE_KEY,
    name: 'Visualização',
    description: 'Consulta informações operacionais sem alterar dados.',
    permissions: [
      ...FIELD_READ.filter((item) => item !== 'signatures.create'),
      'dashboard.read',
      'analytics.read',
      'quotes.read',
      'financial.read',
    ],
    allowedSurfaces: ['WEB'],
  },
];

export function isKnownPermission(permissionCode: string): boolean {
  return KNOWN_PERMISSIONS.has(permissionCode);
}
