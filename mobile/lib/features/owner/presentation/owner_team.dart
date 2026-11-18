import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/orbit_theme.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_tools.dart';

const ownerDelegationLabels = {
  'operations': 'Operações e ordens de serviço',
  'quotes': 'Criar orçamentos',
  'receipts': 'Criar recibos',
  'finance': 'Entradas e saídas',
  'customers': 'Cadastro de clientes',
  'equipment': 'Cadastro de equipamentos',
  'pmoc': 'Planos e execuções de PMOC',
  'rvt': 'RVTs e visitas técnicas',
  'authorization': 'Autorizar e bloquear demandas',
};

OwnerRecords ownerTeam(OwnerTools tools) => OwnerRecords(
  title: 'Equipe de campo',
  createLabel: 'Novo técnico operacional',
  create: tools.unitId != null
      ? (context) => _createMember(context, tools)
      : null,
  load: (_, page, _) => tools.repo.list(
    '/organizations/current/members',
    query: {'page': page, 'limit': 25},
  ),
  subtitle: (row) => [
    ownerText(ownerRow(row['role'])),
    ownerStatus(row['status']),
  ].where((part) => part.isNotEmpty).join(' · '),
  open: (context, row) => _memberActions(context, tools, row),
);

Future<bool> _createMember(BuildContext context, OwnerTools tools) async {
  final roles = await tools.repo.options('/organizations/current/roles');
  final field = roles
      .where((row) => row['key'] == 'FIELD_TECHNICIAN')
      .firstOrNull;
  if (!context.mounted) return false;
  if (field == null) {
    throw const OwnerInputError(
      'O papel Técnico Operacional está indisponível.',
    );
  }
  String? password;
  final created = await ownerForm(
    context,
    title: 'Novo técnico operacional',
    action: 'Cadastrar técnico',
    fields: const [
      OwnerFormField('firstName', 'Nome', required: true, maxLength: 120),
      OwnerFormField('lastName', 'Sobrenome', required: true, maxLength: 120),
      OwnerFormField(
        'email',
        'E-mail de acesso',
        required: true,
        maxLength: 255,
        keyboard: TextInputType.emailAddress,
      ),
    ],
    save: (values, _) async {
      final result = await tools.repo.create(
        '/organizations/current/team/members',
        {...values, 'businessUnitId': tools.unitId, 'roleId': ownerId(field)},
      );
      password = ownerString(result, 'temporaryPassword');
    },
  );
  final temporaryPassword = password;
  if (!created || temporaryPassword == null || !context.mounted) return created;
  await showDialog<void>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('Senha temporária'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Compartilhe com o técnico. O app solicitará a troca no primeiro acesso.',
          ),
          const SizedBox(height: OrbitSpacing.md),
          SelectableText(temporaryPassword),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialog),
          child: const Text('Fechar'),
        ),
        FilledButton(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: temporaryPassword));
            if (dialog.mounted) Navigator.pop(dialog);
          },
          child: const Text('Copiar senha'),
        ),
      ],
    ),
  );
  return created;
}

Future<bool> _memberActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow row,
) {
  final id = ownerId(row);
  final role = ownerRow(row['role']);
  final path = '/organizations/current/team/members/$id';
  final editable =
      row['isOwner'] != true &&
      id != tools.session.user.id &&
      const ['FIELD_TECHNICIAN', 'ASSISTANT_TECHNICIAN'].contains(role['key']);
  final active = row['status'] == 'ACTIVE';
  return ownerActions(
    context,
    ownerText(row),
    [
      if (editable) ...[
        OwnerAction(
          'Editar cadastro',
          Icons.edit_outlined,
          () => ownerForm(
            context,
            title: 'Editar técnico',
            fields: [
              OwnerFormField(
                'firstName',
                'Nome',
                initial: row['firstName'],
                required: true,
                maxLength: 120,
              ),
              OwnerFormField(
                'lastName',
                'Sobrenome',
                initial: row['lastName'],
                required: true,
                maxLength: 120,
              ),
              OwnerFormField(
                'email',
                'E-mail de acesso',
                initial: row['email'],
                required: true,
                maxLength: 255,
                keyboard: TextInputType.emailAddress,
              ),
            ],
            save: (values, _) => tools.repo.update(path, values),
          ),
        ),
        if (active &&
            role['key'] == 'FIELD_TECHNICIAN' &&
            tools.session.isOwner)
          OwnerAction(
            'Permissões da Área do proprietário',
            Icons.admin_panel_settings_outlined,
            () => _delegations(context, tools, row),
          ),
        OwnerAction(
          active ? 'Suspender acesso' : 'Reativar acesso',
          active ? Icons.block : Icons.check_circle_outline,
          () async {
            final label = active ? 'Suspender acesso' : 'Reativar acesso';
            final message = active
                ? 'O técnico perderá o acesso à organização e as permissões delegadas.'
                : 'O técnico voltará a acessar a organização com o papel cadastrado.';
            if (!await ownerConfirm(
              context,
              '$label?',
              message,
              label: label,
            )) {
              return false;
            }
            await tools.repo.update('/organizations/current/members/$id', {
              'status': active ? 'SUSPENDED' : 'ACTIVE',
            });
            return true;
          },
        ),
        OwnerAction(
          'Desligar da equipe',
          Icons.person_remove_outlined,
          () => tools.remove(
            context,
            path,
            'técnico da equipe',
            description:
                'O acesso à organização será encerrado e o histórico será preservado.',
          ),
        ),
      ],
    ],
    details: [
      ownerText(role),
      ownerStatus(row['status']),
      ownerText(row, ['email']),
      ownerRows(row['businessUnits']).map((row) => ownerText(row)).join(', '),
    ].where((part) => part.isNotEmpty).join('\n'),
  );
}

Future<bool> _delegations(
  BuildContext context,
  OwnerTools tools,
  OwnerRow member,
) async {
  final path = '/mobile/owner/members/${ownerId(member)}/delegations';
  final current = ownerValues((await tools.repo.read(path))['areas']).toSet();
  if (!context.mounted) return false;
  return ownerForm(
    context,
    title: 'Permissões · ${ownerText(member)}',
    fields: [
      for (final item in ownerDelegationLabels.entries)
        OwnerFormField(
          item.key,
          item.value,
          initial: current.contains(item.key),
          toggle: true,
        ),
    ],
    save: (values, _) => tools.repo.update(path, {
      'areas': values.entries
          .where((item) => item.value == true)
          .map((item) => item.key)
          .toList(),
    }),
  );
}

Future<bool> openOwnerApprovals(
  BuildContext context,
  OwnerTools tools,
) => ownerActions(context, 'Autorização de demandas', [
  for (final recurring in [false, true])
    for (final authorized in [false, true])
      OwnerAction(
        '${recurring ? 'PMOC e RVT' : 'Ordens de serviço'} · ${authorized ? 'autorizadas' : 'pendentes'}',
        authorized
            ? Icons.check_circle_outline
            : Icons.pending_actions_outlined,
        () async {
          await ownerOpenRecords(
            context,
            _approvals(tools, recurring: recurring, authorized: authorized),
          );
          return false;
        },
      ),
]);

OwnerRecords _approvals(
  OwnerTools tools, {
  required bool recurring,
  required bool authorized,
}) {
  final path = recurring
      ? '/operations/recurring-authorizations'
      : '/mobile/owner/operation-authorizations';
  return OwnerRecords(
    title: authorized ? 'Demandas autorizadas' : 'Demandas pendentes',
    search: true,
    load: (search, page, _) => tools.repo.list(
      path,
      query: {
        'businessUnitId': tools.unitId,
        'search': search,
        'page': page,
        'state': authorized ? 'authorized' : 'pending',
      },
    ),
    subtitle: (row) => [
      ownerText(row, ['code']),
      ownerText(ownerRow(row['responsibleFieldTechnician'])),
      if (row['kind'] == 'PMOC')
        ownerDateLabel(ownerString(row, 'scheduledStart'))
      else
        ownerInstant(tools.zone, ownerString(row, 'scheduledStart')),
    ].where((part) => part.isNotEmpty).join(' · '),
    open: (context, row) async {
      final label = authorized ? 'Bloquear demanda' : 'Autorizar demanda';
      final message = authorized
          ? 'A equipe voltará a precisar de autorização para acessar a demanda.'
          : 'A demanda ficará disponível para a equipe atribuída.';
      if (!await ownerConfirm(context, '$label?', message, label: label)) {
        return false;
      }
      final id = ownerId(row);
      if (recurring) {
        await tools.repo.post(authorized ? '$path/revoke' : path, {
          'items': [
            {'kind': row['kind'], 'id': id, 'version': row['version']},
          ],
        });
      } else {
        final command = '/operations/$id/authorization';
        if (authorized) {
          await tools.repo.remove(command);
        } else {
          await tools.repo.post(command);
        }
      }
      return true;
    },
  );
}
