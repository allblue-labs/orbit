import 'package:flutter/material.dart';
import 'package:timezone/timezone.dart' as tz;

import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_tools.dart';

const _kinds = {
  'MAINTENANCE': 'Manutenção',
  'INSTALLATION': 'Instalação',
  'INSPECTION': 'Inspeção',
  'DELIVERY': 'Entrega',
  'OTHER': 'Outro',
};

const _priorities = {
  'LOW': 'Baixa',
  'NORMAL': 'Normal',
  'HIGH': 'Alta',
  'URGENT': 'Urgente',
};

OwnerRecords ownerOperations(OwnerTools tools, {bool today = false}) {
  final now = tools.now;
  final start = tz.TZDateTime(
    tools.zone.location,
    now.year,
    now.month,
    now.day,
  ).toUtc();
  final end = tz.TZDateTime(
    tools.zone.location,
    now.year,
    now.month,
    now.day + 1,
  ).toUtc().subtract(const Duration(milliseconds: 1));
  return OwnerRecords(
    title: today ? 'Operações de hoje' : 'Operações e OS',
    search: true,
    createLabel: 'Nova ordem de serviço',
    create: tools.can('operations', 'operations.create') && tools.unitId != null
        ? (context) => _createOperation(context, tools)
        : null,
    load: (search, page, _) => tools.repo.list(
      '/operations',
      query: {
        ...ownerPageQuery(search, page, unitId: tools.unitId),
        if (today) ...{
          'scheduledFrom': start.toIso8601String(),
          'scheduledTo': end.toIso8601String(),
        },
      },
    ),
    subtitle: (row) => _operationCaption(row, tools),
    open: (context, row) => _operationActions(context, tools, row),
  );
}

String _operationCaption(OwnerRow row, OwnerTools tools) => [
  ownerText(row, ['serviceOrderCode', 'code']),
  ownerStatus(row['status']),
  ownerText(ownerRow(row['customer'])),
  ownerInstant(tools.zone, ownerString(row, 'scheduledStart')),
  ownerText(ownerRow(row['responsibleFieldTechnician'])),
].where((part) => part.isNotEmpty).join(' · ');

Future<bool> _createOperation(BuildContext context, OwnerTools tools) async {
  final customer = await tools.customer(context);
  if (customer == null || !context.mounted) return false;
  final code = ownerCode('OS');
  return _operationForm(context, tools, customer: customer, code: code);
}

Future<bool> _operationForm(
  BuildContext context,
  OwnerTools tools, {
  OwnerRow? current,
  OwnerRow? customer,
  String? code,
}) {
  final creating = current == null;
  final row = current ?? {};
  final customerId = customer == null
      ? ownerString(row, 'customerId')
      : ownerId(customer);
  final start = tools.instant(row, 'scheduledStart');
  final end = tools.instant(row, 'scheduledEnd');
  return ownerForm(
    context,
    title: creating
        ? 'Nova OS · ${ownerText(customer ?? {})}'
        : 'Editar ordem de serviço',
    zone: tools.zone,
    sections: {
      'title': 'Serviço',
      if (creating) 'assets': 'Local e equipamentos' else 'address': 'Local',
      'start': 'Agenda e equipe',
      'amount': 'Valores',
    },
    fields: [
      OwnerFormField('title', 'Título', initial: row['title'], required: true),
      OwnerFormField(
        'kind',
        'Tipo de serviço',
        initial: row['kind'] ?? 'MAINTENANCE',
        required: true,
        choices: _kinds,
      ),
      OwnerFormField(
        'priority',
        'Prioridade',
        initial: row['priority'] ?? 'NORMAL',
        choices: _priorities,
      ),
      OwnerFormField(
        'description',
        'Solicitação do cliente',
        initial: row['description'],
        maxLength: 4000,
        lines: 4,
      ),
      if (creating && customerId != null)
        OwnerFormField(
          'assets',
          'Equipamentos',
          many: true,
          pick: (search) => tools.equipment(customerId, search),
        ),
      if (customerId != null)
        OwnerFormField(
          'address',
          'Endereço',
          initial: rowOrNull(row['customerAddress']),
          pick: (search) => tools.addresses(customerId, search),
        ),
      OwnerFormField('sector', 'Setor', initial: row['sector'], maxLength: 120),
      OwnerFormField('start', 'Início previsto', initial: start, time: true),
      OwnerFormField('end', 'Término previsto', initial: end, time: true),
      if (creating) ...[
        OwnerFormField(
          'technician',
          'Técnico em campo',
          pick: tools.technicians,
        ),
        OwnerFormField(
          'assistants',
          'Auxiliares',
          many: true,
          pick: (search) => tools.technicians(search, assistant: true),
        ),
      ],
      OwnerFormField(
        'amount',
        r'Valor (R$)',
        initial: row['manualAmount'],
        numeric: true,
      ),
      OwnerFormField(
        'amountVisible',
        'Mostrar valor ao técnico',
        initial: row['amountVisibleInField'] == true,
        toggle: true,
      ),
    ],
    save: (values, sheet) async {
      final tech = creating
          ? pickId(values['technician'])
          : ownerString(row, 'responsibleFieldTechnicianId');
      final assistants = creating
          ? pickIds(values['assistants'])
          : ownerRows(
              row['auxiliaryTechnicians'],
            ).map((item) => item['userId'] as String).toList();
      await _checkSchedule(
        sheet,
        tools,
        [if (tech != null) tech, ...assistants],
        isoInstant(values, 'start'),
        isoInstant(values, 'end'),
        exclude: creating ? null : ownerId(row),
      );
      final input = <String, dynamic>{
        'title': values['title'],
        'kind': values['kind'],
        'priority': values['priority'],
        'description': values['description'] ?? '',
        'sector': values['sector'] ?? '',
        if (pickId(values['address']) case final address?)
          'customerAddressId': address,
        'scheduledStart': isoInstant(values, 'start'),
        'scheduledEnd': isoInstant(values, 'end'),
        'manualAmount': double.tryParse(decimalText(values, 'amount') ?? ''),
        'amountVisibleInField': values['amountVisible'],
      };
      if (creating) {
        await tools.repo.post('/operations', {
          ...input,
          'code': code,
          'businessUnitId': tools.unitId,
          'customerId': customerId,
          'assetIds': pickIds(values['assets']),
          if (tech != null) 'responsibleFieldTechnicianId': tech,
          if (assistants.isNotEmpty) 'auxiliaryTechnicianIds': assistants,
        });
      } else {
        await tools.repo.update('/operations/${ownerId(row)}', input);
      }
    },
  );
}

Future<void> _checkSchedule(
  BuildContext context,
  OwnerTools tools,
  List<String> users,
  String? start,
  String? end, {
  String? exclude,
}) async {
  if (users.isEmpty || start == null) return;
  final warnings = await tools.repo.commandList('/operations/schedule-check', {
    'userIds': users.toSet().toList(),
    'scheduledStart': start,
    if (end != null) 'scheduledEnd': end,
    if (exclude != null) 'excludeOperationId': exclude,
  });
  if (warnings.isEmpty) return;
  if (!context.mounted ||
      !await ownerConfirm(
        context,
        'Horário próximo de outro atendimento',
        warnings
            .take(3)
            .map(
              (row) => [
                ownerText(row, ['userName']),
                ownerText(row),
                ownerInstant(tools.zone, ownerString(row, 'startsAt')),
              ].where((part) => part.isNotEmpty).join(' · '),
            )
            .join('\n'),
        label: 'Manter horário',
      )) {
    throw const OwnerFormCancelled();
  }
}

Future<bool> _operationActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow summary,
) async {
  final path = '/operations/${ownerId(summary)}';
  final row = await tools.repo.read(path);
  if (!context.mounted) return false;
  final finished = const {'COMPLETED', 'CANCELLED'}.contains(row['status']);
  return ownerActions(
    context,
    ownerText(row),
    [
      if (!finished && tools.can('operations', 'operations.update'))
        OwnerAction(
          'Editar ou reagendar',
          Icons.edit_calendar_outlined,
          () => _operationForm(context, tools, current: row),
        ),
      if (!finished && tools.can('operations', 'operations.assign'))
        OwnerAction(
          'Atribuir técnico em campo',
          Icons.person_add_alt,
          () async {
            final result = await ownerPick(
              context,
              title: 'Técnico em campo',
              load: tools.technicians,
            );
            if (!context.mounted || result == null || result.isEmpty) {
              return false;
            }
            final technician = ownerId(result.first);
            try {
              await _checkSchedule(
                context,
                tools,
                [technician],
                ownerString(row, 'scheduledStart'),
                ownerString(row, 'scheduledEnd'),
                exclude: ownerId(row),
              );
            } on OwnerFormCancelled {
              return false;
            }
            await tools.repo.update('$path/responsible-field-technician', {
              'userId': technician,
            });
            return true;
          },
        ),
      if (tools.can('operations', 'operations.history.read'))
        OwnerAction('Acompanhar histórico', Icons.history, () async {
          await ownerOpenRecords(
            context,
            OwnerRecords(
              title: 'Linha do tempo',
              load: (_, _, _) async => OwnerPage(
                ownerRows((await tools.repo.read('$path/timeline'))['events']),
              ),
              caption: (item) => _historyCaption(item),
              subtitle: (item) => [
                ownerInstant(tools.zone, ownerString(item, 'createdAt')),
                ownerText(ownerRow(item['user'])),
              ].where((part) => part.isNotEmpty).join(' · '),
            ),
          );
          return false;
        }),
      if (ownerValues(row['transitions']).contains('CANCELLED') &&
          tools.can('operations', 'operations.status.update'))
        OwnerAction(
          'Cancelar atendimento',
          Icons.cancel_outlined,
          () => ownerForm(
            context,
            title: 'Cancelar atendimento',
            action: 'Confirmar cancelamento',
            fields: const [
              OwnerFormField(
                'reason',
                'Motivo',
                required: true,
                maxLength: 500,
                lines: 3,
              ),
            ],
            save: (values, _) => tools.repo.update('$path/status', {
              'status': 'CANCELLED',
              'reason': values['reason'],
            }),
          ),
        ),
      if (row['status'] == 'CANCELLED' &&
          tools.can('operations', 'operations.delete'))
        OwnerAction(
          'Remover ordem de serviço',
          Icons.delete_outline,
          () => tools.remove(context, path, 'ordem de serviço'),
        ),
    ],
    details: [
      _operationCaption(row, tools),
      ownerText(row, ['description']),
      ownerRows(row['assets']).map((item) => ownerText(item)).join(', '),
    ].where((part) => part.isNotEmpty).join('\n'),
  );
}

String _historyCaption(OwnerRow item) {
  final status = ownerStatus(item['toStatus']);
  if (status.isNotEmpty) return status;
  return switch (item['action']) {
    'CREATED' => 'Atendimento criado',
    'UPDATED' => 'Dados atualizados',
    'ASSIGNED' => 'Técnico atribuído',
    'UNASSIGNED' => 'Atribuição removida',
    'ASSIGNMENT_AUTHORIZED' => 'Atendimento autorizado',
    'ASSIGNMENT_AUTHORIZATION_REVOKED' => 'Autorização retirada',
    _ => 'Atendimento atualizado',
  };
}
