import 'package:flutter/material.dart';

import '../../../core/time/orbit_timezone.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_tools.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../pmoc/presentation/pmoc_entry.dart';

OwnerRecords ownerPmoc(OwnerTools tools) => OwnerRecords(
  title: 'Planos de PMOC',
  search: true,
  createLabel: 'Novo PMOC',
  create: tools.can('pmoc', 'pmoc.manage') && tools.unitId != null
      ? (context) async {
          final customer = await tools.customer(context);
          if (customer == null || !context.mounted) return false;
          return _pmocForm(context, tools, customer: customer);
        }
      : null,
  load: (search, page, _) => tools.repo.list(
    '/pmoc/plans',
    query: ownerPageQuery(search, page, unitId: tools.unitId),
  ),
  subtitle: (row) => _planCaption(row, 'compliance', 'nextDueOn'),
  open: (context, row) => _pmocActions(context, tools, row),
);

String _planCaption(OwnerRow row, [String? dates, String? key]) => [
  ownerText(row, ['code']),
  ownerText(ownerRow(row['customer'])),
  ownerStatus(row['status']),
  if (dates != null && key != null)
    ownerDateLabel(ownerString(ownerRow(row[dates]), key)),
].where((part) => part.isNotEmpty).join(' · ');

Future<bool> _pmocForm(
  BuildContext context,
  OwnerTools tools, {
  OwnerRow? current,
  OwnerRow? customer,
}) {
  final row = current ?? {};
  final validity = ownerRow(row['validity']);
  final frequency = ownerRow(row['frequency']);
  final config = ownerRow(row['configuration']);
  final location = ownerRow(config['serviceLocation']);
  final editableSchedule = current == null || row['status'] == 'DRAFT';
  final customerId = ownerId(customer ?? ownerRow(row['customer']));
  return ownerForm(
    context,
    title: current == null
        ? 'Novo PMOC · ${ownerText(customer!)}'
        : 'Editar PMOC',
    zone: tools.zone,
    sections: const {
      'name': 'Plano e equipe',
      'units': 'Roteiros e local',
      'startsOn': 'Vigência',
    },
    fields: [
      OwnerFormField(
        'name',
        'Nome do plano',
        required: true,
        initial: row['name'],
      ),
      OwnerFormField(
        'responsible',
        'Responsável técnico',
        required: true,
        initial: rowOrNull(row['technicalResponsible']),
        pick: (search) => tools.technicians(search, responsible: true),
      ),
      OwnerFormField(
        'technician',
        'Técnico em campo',
        initial: rowOrNull(row['technician']),
        pick: tools.technicians,
      ),
      if (current == null)
        OwnerFormField(
          'assets',
          'Equipamentos cobertos',
          many: true,
          required: true,
          pick: (search) => tools.equipment(customerId, search),
        ),
      OwnerFormField(
        'units',
        'Unidades e roteiros do PMOC',
        many: true,
        initial: ownerRows(row['units']),
        pick: (search) async => (await tools.repo.options(
          '/pmoc/units',
        )).where((row) => matches(row, search)).toList(),
      ),
      OwnerFormField(
        'address',
        'Endereço de atendimento',
        initial: rowOrNull(location),
        pick: (search) => tools.addresses(customerId, search),
      ),
      if (editableSchedule) ...[
        OwnerFormField(
          'startsOn',
          'Início da vigência',
          date: true,
          required: true,
          initial:
              DateTime.tryParse(ownerString(validity, 'startsOn') ?? '') ??
              tools.now,
        ),
        OwnerFormField(
          'endsOn',
          'Fim da vigência',
          date: true,
          initial: DateTime.tryParse(ownerString(validity, 'endsOn') ?? ''),
        ),
        OwnerFormField(
          'frequencyAmount',
          'Intervalo',
          required: true,
          numeric: true,
          initial: frequency['amount'] ?? 1,
          maxLength: 3,
        ),
        OwnerFormField(
          'frequencyUnit',
          'Periodicidade',
          required: true,
          initial: frequency['unit'] ?? 'MONTHS',
          choices: const {
            'DAYS': 'Dias',
            'WEEKS': 'Semanas',
            'MONTHS': 'Meses',
            'YEARS': 'Anos',
          },
        ),
      ],
      OwnerFormField(
        'notes',
        'Observações',
        initial: row['notes'],
        lines: 3,
        maxLength: 4000,
      ),
    ],
    save: (values, _) {
      final address = _serviceLocation(values['address']);
      final frequencyAmount = int.tryParse(
        ownerString(values, 'frequencyAmount') ?? '',
      );
      if (editableSchedule &&
          (frequencyAmount == null ||
              frequencyAmount < 1 ||
              frequencyAmount > 120)) {
        throw const OwnerInputError('Informe um intervalo inteiro de 1 a 120.');
      }
      final startsOn = isoDate(values, 'startsOn');
      final endsOn = isoDate(values, 'endsOn');
      if (endsOn != null &&
          startsOn != null &&
          endsOn.compareTo(startsOn) < 0) {
        throw const OwnerInputError(
          'O fim da vigência deve ser igual ou posterior ao início.',
        );
      }
      final input = {
        'name': values['name'],
        'technicalResponsibleUserId': pickId(values['responsible']),
        if (pickId(values['technician']) case final id?) 'technicianUserId': id,
        'unitIds': pickIds(values['units']),
        if (address.isNotEmpty) 'serviceLocation': address,
        if (editableSchedule) ...{
          'startsOn': startsOn,
          if (endsOn != null) 'endsOn': endsOn,
          'frequencyAmount': frequencyAmount,
          'frequencyUnit': values['frequencyUnit'],
        },
        'notes': values['notes'] ?? '',
      };
      return current == null
          ? tools.repo.post('/pmoc/plans', {
              ...input,
              'businessUnitId': tools.unitId,
              'customerId': customerId,
              'assetIds': pickIds(values['assets']),
            })
          : tools.repo.update('/pmoc/plans/${ownerId(row)}', input);
    },
  );
}

OwnerRow _serviceLocation(Object? value) {
  final row = ownerRow(value);
  return {
    for (final key in [
      'id',
      'label',
      'street',
      'number',
      'district',
      'complement',
      'city',
      'stateCode',
      'postalCode',
    ])
      if (present(ownerString(row, key)) case final text?) key: text,
    if (present(ownerString(row, 'state') ?? ownerString(row, 'stateCode'))
        case final state?)
      'state': state,
  };
}

Future<bool> _pmocActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow summary,
) async {
  final path = '/pmoc/plans/${ownerId(summary)}';
  final row = await tools.repo.read(path);
  if (!context.mounted) return false;
  final transitions = ownerValues(row['allowedTransitions']);
  final manage = tools.can('pmoc', 'pmoc.manage');
  return ownerActions(context, ownerText(row), [
    if (manage &&
        const ['DRAFT', 'ACTIVE', 'SUSPENDED'].contains(row['status']))
      OwnerAction(
        'Editar plano',
        Icons.edit_outlined,
        () => _pmocForm(context, tools, current: row),
      ),
    OwnerAction('Ciclos e execuções', Icons.event_repeat_outlined, () async {
      await ownerOpenRecords(context, _pmocCycles(tools, ownerId(row)));
      return false;
    }),
    OwnerAction('Equipamentos cobertos', Icons.handyman_outlined, () async {
      await ownerOpenRecords(context, _pmocEquipment(tools, path, row));
      return false;
    }),
    if (manage) ...[
      if (transitions.contains('ACTIVE'))
        OwnerAction(
          'Ativar plano',
          Icons.play_circle_outline,
          () =>
              _pmocTransition(context, tools, path, 'activate', 'Ativar plano'),
        ),
      if (transitions.contains('SUSPENDED'))
        OwnerAction(
          'Suspender plano',
          Icons.pause_circle_outline,
          () => _pmocTransition(
            context,
            tools,
            path,
            'suspend',
            'Suspender plano',
          ),
        ),
      if (transitions.contains('CANCELLED'))
        OwnerAction(
          'Cancelar plano',
          Icons.cancel_outlined,
          () =>
              _pmocTransition(context, tools, path, 'cancel', 'Cancelar plano'),
        ),
    ],
  ], details: _planCaption(row, 'compliance', 'nextDueOn'));
}

Future<bool> _pmocTransition(
  BuildContext context,
  OwnerTools tools,
  String path,
  String command,
  String label,
) => ownerForm(
  context,
  title: label,
  action: label,
  fields: [
    OwnerFormField(
      'reason',
      'Motivo',
      maxLength: 500,
      lines: 3,
      required: command != 'activate',
    ),
  ],
  save: (values, _) => tools.repo.post('$path/$command', {
    if (values['reason'] case final String reason) 'reason': reason,
  }),
);

OwnerRecords _pmocEquipment(OwnerTools tools, String path, OwnerRow plan) {
  final manage =
      tools.can('pmoc', 'pmoc.manage') && plan['status'] != 'CANCELLED';
  final customerId = ownerId(ownerRow(plan['customer']));
  return OwnerRecords(
    title: 'Equipamentos cobertos',
    load: (_, _, _) => tools.repo.list('$path/equipment'),
    caption: (row) => ownerText(ownerRow(row['asset'])),
    createLabel: 'Adicionar equipamento',
    create: !manage
        ? null
        : (context) async {
            final all = await tools.repo.options('$path/equipment');
            final covered = all
                .map((row) => ownerId(ownerRow(row['asset'])))
                .toSet();
            if (!context.mounted) return false;
            final choice = await ownerPick(
              context,
              title: 'Equipamento',
              load: (search) async => (await tools.equipment(
                customerId,
                search,
              )).where((row) => !covered.contains(ownerId(row))).toList(),
            );
            if (choice == null || choice.isEmpty) return false;
            await tools.repo.post('$path/equipment', {
              'assetId': ownerId(choice.first),
            });
            return true;
          },
    open: !manage
        ? null
        : (context, row) =>
              ownerActions(context, ownerText(ownerRow(row['asset'])), [
                OwnerAction(
                  'Retirar do plano',
                  Icons.remove_circle_outline,
                  () => tools.remove(
                    context,
                    '$path/equipment/${ownerId(row)}',
                    'cobertura do equipamento',
                    description: 'O histórico das execuções será preservado.',
                  ),
                ),
              ]),
  );
}

OwnerRecords _pmocCycles(OwnerTools tools, String planId) => OwnerRecords(
  title: 'Ciclos de PMOC',
  load: (_, _, _) => tools.repo.list('/pmoc/plans/$planId/executions'),
  caption: (row) => 'Ciclo ${row['sequenceNumber'] ?? ''}',
  subtitle: (row) => [
    ownerDateLabel(ownerString(row, 'dueOn')),
    ownerStatus(row['status']),
  ].where((part) => part.isNotEmpty).join(' · '),
  open: (context, row) async {
    await ownerOpenRecords(
      context,
      _pmocExecutions(tools, planId, ownerId(row)),
    );
    return false;
  },
);

OwnerRecords _pmocExecutions(OwnerTools tools, String planId, String cycleId) {
  final cycle = '/pmoc/plans/$planId/cycles/$cycleId';
  return OwnerRecords(
    title: 'Execuções por equipamento',
    load: (_, _, _) => tools.repo.list('$cycle/equipment-executions'),
    caption: (row) => ownerText(ownerRow(row['equipment'])),
    subtitle: (row) => [
      ownerStatus(row['status']),
      ownerText(ownerRow(row['plannedFieldTechnician'])),
      ownerInstant(
        tools.zone,
        ownerString(ownerRow(row['schedule']), 'scheduledFor'),
      ),
    ].where((part) => part.isNotEmpty).join(' · '),
    open: (context, row) {
      final equipment = ownerRow(row['equipment']);
      final permissions = ownerRow(row['management']);
      final actions = ownerValues(permissions['allowedActions']);
      final schedule = ownerRow(row['schedule']);
      final path = '$cycle/equipment/${ownerId(equipment)}';
      final version = permissions['version'];
      return ownerActions(
        context,
        ownerText(equipment),
        [
          /* "Iniciar", e não "Abrir": abrir é a ação do atendimento avulso. E
             inicia de fato — pela mesma porta da fila —, em vez de levar a uma
             tela que pedia para abrir de novo. */
          if (tools.session.isOwner &&
              ownerRow(row['eligibility'])['ready'] == true &&
              const ['NOT_STARTED', 'IN_PROGRESS'].contains(row['status']))
            OwnerAction(
              row['status'] == 'IN_PROGRESS'
                  ? 'Continuar atendimento'
                  : 'Iniciar atendimento',
              Icons.play_circle_outline,
              () => enterPmocAttendance(
                context,
                PmocAddressContract(
                  planId: planId,
                  cycleId: cycleId,
                  assetId: ownerId(equipment),
                ),
                start: true,
              ),
            ),
          if (actions.contains('EDIT') && version is String)
            OwnerAction(
              'Agendar ou reatribuir',
              Icons.edit_calendar_outlined,
              () => ownerForm(
                context,
                title: 'Agendar execução',
                zone: tools.zone,
                fields: [
                  OwnerFormField(
                    'technician',
                    'Técnico em campo',
                    initial: rowOrNull(row['plannedFieldTechnician']),
                    pick: tools.technicians,
                  ),
                  OwnerFormField(
                    'scheduledFor',
                    'Data e hora',
                    time: true,
                    initial: tools.instant(schedule, 'scheduledFor'),
                  ),
                  OwnerFormField(
                    'notes',
                    'Observações',
                    initial: schedule['notes'],
                    maxLength: 1000,
                    lines: 3,
                  ),
                ],
                save: (values, _) => tools.repo.update('$path/schedule', {
                  'expectedVersion': version,
                  'responsibleFieldTechnicianId': pickId(values['technician']),
                  'scheduledFor': isoInstant(values, 'scheduledFor'),
                  'notes': values['notes'] ?? '',
                }),
              ),
            ),
          if (actions.contains('CANCEL') && version is String)
            OwnerAction(
              'Cancelar execução',
              Icons.cancel_outlined,
              () => ownerForm(
                context,
                title: 'Cancelar execução',
                action: 'Confirmar cancelamento',
                fields: const [
                  OwnerFormField(
                    'reason',
                    'Motivo',
                    required: true,
                    lines: 3,
                    maxLength: 1000,
                  ),
                ],
                save: (values, _) => tools.repo.post('$path/cancel', {
                  'expectedVersion': version,
                  'reason': values['reason'],
                }),
              ),
            ),
        ],
        details: [
          ownerStatus(row['status']),
          ownerText(ownerRow(row['plannedFieldTechnician'])),
          ownerInstant(tools.zone, ownerString(schedule, 'scheduledFor')),
          ownerText(schedule, ['notes', 'cancellationReason']),
          ownerText(ownerRow(row['execution']), ['notes']),
        ].where((part) => part.isNotEmpty).join('\n'),
      );
    },
  );
}

OwnerRecords ownerRvt(OwnerTools tools) => OwnerRecords(
  title: 'Visitas técnicas (RVT)',
  search: true,
  createLabel: 'Novo RVT',
  create: tools.can('rvt', 'rvt.manage') && tools.unitId != null
      ? (context) async {
          final customer = await tools.customer(context);
          if (customer == null || !context.mounted) return false;
          return _rvtForm(context, tools, customer: customer);
        }
      : null,
  load: (search, _, cursor) => tools.repo.list(
    '/rvt/configurations',
    query: {
      'businessUnitId': tools.unitId,
      'limit': 25,
      'cursor': cursor,
      'search': search,
    },
  ),
  subtitle: (row) => _planCaption(row),
  open: (context, summary) => _rvtActions(context, tools, summary),
);

Future<bool> _rvtForm(
  BuildContext context,
  OwnerTools tools, {
  OwnerRow? current,
  OwnerRow? customer,
}) {
  final row = current ?? {};
  final coverage = ownerRow(row['coverage']);
  final location = ownerRow(row['serviceLocation']);
  final customerId = ownerId(customer ?? ownerRow(row['customer']));
  final timezone = OrbitTimezone.resolve([
    ownerString(row, 'timezone'),
    tools.session.businessUnit?.timezone,
    tools.zone.name,
  ]);
  final code = ownerCode('RVT');
  return ownerForm(
    context,
    title: current == null
        ? 'Novo RVT · ${ownerText(customer!)}'
        : 'Editar RVT',
    zone: timezone,
    sections: const {
      'name': 'Identificação',
      'start': 'Agenda',
      'address': 'Local e equipe',
    },
    fields: [
      OwnerFormField(
        'name',
        'Nome do atendimento',
        initial: row['name'],
        required: true,
      ),
      OwnerFormField(
        'type',
        'Tipo de manutenção',
        initial: rowOrNull(row['maintenanceType']),
        required: true,
        pick: (search) async => (await tools.repo.options(
          '/rvt/maintenance-types',
        )).where((row) => matches(row, search)).toList(),
      ),
      if (current == null)
        const OwnerFormField(
          'mode',
          'Tipo de agenda',
          initial: 'ONE_TIME',
          required: true,
          choices: {
            'ONE_TIME': 'Visita única',
            'RECURRING': 'Visitas recorrentes',
          },
        ),
      OwnerFormField(
        'start',
        'Data da primeira visita',
        required: true,
        date: true,
        initial:
            DateTime.tryParse(ownerString(coverage, 'start') ?? '') ??
            tools.now,
      ),
      if (current == null || row['scheduleMode'] == 'RECURRING')
        OwnerFormField(
          'end',
          'Fim da vigência (para recorrência)',
          date: true,
          initial: DateTime.tryParse(ownerString(coverage, 'end') ?? ''),
        ),
      OwnerFormField(
        'hour',
        'Hora prevista (HH:mm)',
        initial: row['startTime'] ?? '09:00',
        required: true,
        maxLength: 5,
      ),
      OwnerFormField(
        'address',
        'Endereço cadastrado',
        initial: rowOrNull(location),
        pick: (search) => tools.addresses(customerId, search),
      ),
      OwnerFormField(
        'assets',
        'Equipamentos',
        initial: ownerRows(row['equipment']),
        many: true,
        required: true,
        pick: (search) => tools.equipment(customerId, search),
      ),
      OwnerFormField(
        'technician',
        'Técnico em campo',
        initial: rowOrNull(row['defaultResponsibleFieldTechnician']),
        pick: tools.technicians,
      ),
      OwnerFormField(
        'responsible',
        'Responsável técnico',
        initial: rowOrNull(row['technicalResponsible']),
        pick: (search) => tools.technicians(search, responsible: true),
      ),
      OwnerFormField(
        'notes',
        'Orientações da visita',
        initial: ownerRow(row['procedure'])['description'],
        lines: 3,
        maxLength: 4000,
      ),
    ],
    save: (values, _) {
      final recurring = (row['scheduleMode'] ?? values['mode']) == 'RECURRING';
      final start = isoDate(values, 'start')!;
      final end = isoDate(values, 'end');
      final hour = values['hour'] as String;
      if (!RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(hour)) {
        throw const OwnerInputError(
          'Informe a hora no formato HH:mm, entre 00:00 e 23:59.',
        );
      }
      if (recurring && (end == null || end.compareTo(start) < 0)) {
        throw const OwnerInputError(
          'Informe o fim da vigência para as visitas recorrentes.',
        );
      }
      final address = _serviceLocation(values['address']);
      if (address.isEmpty) {
        throw const OwnerInputError(
          'Selecione um endereço cadastrado para a visita.',
        );
      }
      final input = {
        'name': values['name'],
        'maintenanceTypeId': pickId(values['type']),
        'coverageStart': start,
        if (recurring) 'coverageEnd': end,
        'startTime': hour,
        'timezone': timezone.name,
        'serviceLocation': address,
        'equipmentIds': pickIds(values['assets']),
        'defaultResponsibleFieldTechnicianId': pickId(values['technician']),
        'technicalResponsibleUserId': pickId(values['responsible']),
        'requiresTechnicalResponsible': pickId(values['responsible']) != null,
        'procedure': {
          ...ownerRow(row['procedure']),
          'description': values['notes'] ?? '',
        },
      };
      return current == null
          ? tools.repo.post('/rvt/configurations', {
              ...input,
              'businessUnitId': tools.unitId,
              'customerId': customerId,
              'code': code,
              'scheduleMode': values['mode'],
            })
          : tools.repo.update('/rvt/configurations/${ownerId(row)}', input);
    },
  );
}

Future<bool> _rvtActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow summary,
) async {
  final path = '/rvt/configurations/${ownerId(summary)}';
  final row = await tools.repo.read(path);
  if (!context.mounted) return false;
  final manage = tools.can('rvt', 'rvt.manage') && row['status'] == 'ACTIVE';
  return ownerActions(context, ownerText(row), [
    if (manage)
      OwnerAction(
        'Editar RVT',
        Icons.edit_outlined,
        () => _rvtForm(context, tools, current: row),
      ),
    OwnerAction('Visitas e atendimentos', Icons.event_note_outlined, () async {
      await ownerOpenRecords(context, _rvtVisits(tools, path, row));
      return false;
    }),
    if (manage)
      OwnerAction('Cancelar RVT', Icons.cancel_outlined, () async {
        if (!await ownerConfirm(
          context,
          'Cancelar RVT?',
          'As visitas previstas serão canceladas e o histórico de atendimentos será preservado.',
          label: 'Cancelar RVT',
        )) {
          return false;
        }
        await tools.repo.remove(path);
        return true;
      }),
  ], details: _planCaption(row));
}

OwnerRecords _rvtVisits(OwnerTools tools, String path, OwnerRow configuration) {
  final manage =
      tools.can('rvt', 'rvt.manage') && configuration['status'] == 'ACTIVE';
  final occurrences = '$path/occurrences';
  final timezone = OrbitTimezone.resolve([
    ownerString(configuration, 'timezone'),
    tools.zone.name,
  ]);
  return OwnerRecords(
    title: 'Visitas · ${ownerText(configuration)}',
    load: (_, _, _) async =>
        OwnerPage(ownerRows((await tools.repo.read(path))['occurrences'])),
    caption: (row) =>
        'Visita ${row['sequence'] ?? row['sequenceNumber'] ?? ''}',
    subtitle: (row) => [
      ownerInstant(timezone, ownerString(row, 'scheduledFor')),
      ownerStatus(row['status']),
    ].where((part) => part.isNotEmpty).join(' · '),
    createLabel: 'Nova visita',
    create: manage
        ? (context) => _visitForm(context, tools, configuration, occurrences)
        : null,
    open: (context, row) {
      final visit = '$occurrences/${ownerId(row)}';
      final editable =
          manage &&
          const ['SCHEDULED', 'CANCELLED'].contains(row['status']) &&
          row['executionId'] == null;
      final assets = ownerRows(configuration['equipment']).where(
        (asset) => ownerValues(row['equipmentIds']).contains(ownerId(asset)),
      );
      return ownerActions(
        context,
        'Visita ${row['sequence'] ?? ''}',
        [
          if (editable)
            OwnerAction(
              'Reagendar ou reatribuir',
              Icons.edit_calendar_outlined,
              () => _visitForm(
                context,
                tools,
                configuration,
                occurrences,
                current: row,
              ),
            ),
          if (editable && row['status'] == 'SCHEDULED')
            OwnerAction('Cancelar visita', Icons.cancel_outlined, () async {
              if (!await ownerConfirm(
                context,
                'Cancelar visita?',
                'O agendamento será cancelado.',
                label: 'Cancelar visita',
              )) {
                return false;
              }
              await tools.repo.update(visit, {'status': 'CANCELLED'});
              return true;
            }),
          if (editable)
            OwnerAction(
              'Remover visita',
              Icons.delete_outline,
              () => tools.remove(context, visit, 'visita'),
            ),
        ],
        details: [
          ownerStatus(row['status']),
          ownerInstant(timezone, ownerString(row, 'scheduledFor')),
          assets.map((asset) => ownerText(asset)).join(', '),
        ].where((part) => part.isNotEmpty).join('\n'),
      );
    },
  );
}

Future<bool> _visitForm(
  BuildContext context,
  OwnerTools tools,
  OwnerRow configuration,
  String path, {
  OwnerRow? current,
}) async {
  final row = current ?? {};
  final timezone = OrbitTimezone.resolve([
    ownerString(configuration, 'timezone'),
    tools.zone.name,
  ]);
  final scheduled = DateTime.tryParse(ownerString(row, 'scheduledFor') ?? '');
  final choices = ownerRows(configuration['equipment']);
  final technicians = await tools.technicians('');
  if (!context.mounted) return false;
  final technicianId =
      row['responsibleFieldTechnicianId'] ??
      pickId(configuration['defaultResponsibleFieldTechnician']);
  return ownerForm(
    context,
    title: current == null ? 'Nova visita' : 'Reagendar ou reatribuir visita',
    zone: timezone,
    fields: [
      OwnerFormField(
        'scheduled',
        'Data e hora',
        required: true,
        time: true,
        initial: scheduled == null ? null : timezone.at(scheduled),
      ),
      OwnerFormField(
        'technician',
        'Técnico em campo',
        initial: technicians
            .where((row) => ownerId(row) == technicianId)
            .firstOrNull,
        pick: tools.technicians,
      ),
      OwnerFormField(
        'assets',
        'Equipamentos',
        many: true,
        required: true,
        initial: current == null
            ? choices
            : choices
                  .where(
                    (asset) => ownerValues(
                      row['equipmentIds'],
                    ).contains(ownerId(asset)),
                  )
                  .toList(),
        pick: (search) async =>
            choices.where((row) => matches(row, search)).toList(),
      ),
    ],
    save: (values, _) {
      final scheduled = values['scheduled'] as DateTime;
      final input = {
        'scheduledDate': ownerDate(scheduled),
        'startTime': ownerTime(scheduled),
        'responsibleFieldTechnicianId': pickId(values['technician']),
        'equipmentIds': pickIds(values['assets']),
        'status': 'SCHEDULED',
      };
      return current == null
          ? tools.repo.post(path, input)
          : tools.repo.update('$path/${ownerId(row)}', input);
    },
  );
}
