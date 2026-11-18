import 'package:flutter/material.dart';

import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_tools.dart';

OwnerRecords ownerCustomers(OwnerTools tools) => OwnerRecords(
  title: 'Clientes',
  search: true,
  createLabel: 'Novo cliente',
  create: tools.can('customers', 'customers.create')
      ? (context) => _customerForm(context, tools)
      : null,
  load: (search, page, _) =>
      tools.repo.list('/customers', query: ownerPageQuery(search, page)),
  subtitle: (row) => [
    ownerText(row, ['documentNumber']),
    ownerStatus(row['status']),
  ].where((text) => text.isNotEmpty).join(' · '),
  open: (context, row) => _customerActions(context, tools, row),
);

Future<bool> _customerActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow summary,
) async {
  final path = '/customers/${ownerId(summary)}';
  final row = await tools.repo.read(path);
  if (!context.mounted) return false;
  return ownerActions(
    context,
    ownerText(row),
    [
      if (tools.can('customers', 'customers.update'))
        OwnerAction(
          'Editar cadastro',
          Icons.edit_outlined,
          () => _customerForm(context, tools, current: row),
        ),
      OwnerAction('Endereços', Icons.location_on_outlined, () async {
        await ownerOpenRecords(context, _addresses(tools, row));
        return false;
      }),
      if (tools.access.areas.contains('equipment'))
        OwnerAction('Equipamentos', Icons.handyman_outlined, () async {
          await ownerOpenRecords(context, ownerEquipment(tools, customer: row));
          return false;
        }),
      if (tools.can('customers', 'customers.delete'))
        OwnerAction(
          'Remover cliente',
          Icons.delete_outline,
          () => tools.remove(context, path, 'cliente'),
        ),
    ],
    details: [
      ownerText(row, ['documentNumber']),
      ownerText(row, ['email']),
      ownerText(row, ['phone']),
      ownerText(row, ['notes']),
    ].where((item) => item.isNotEmpty).join('\n'),
  );
}

Future<bool> _customerForm(
  BuildContext context,
  OwnerTools tools, {
  OwnerRow? current,
}) {
  final row = current ?? {};
  return ownerForm(
    context,
    title: current == null ? 'Novo cliente' : 'Editar cliente',
    fields: [
      OwnerFormField(
        'type',
        'Tipo de cliente',
        initial: row['type'] ?? 'INDIVIDUAL',
        required: true,
        choices: const {
          'INDIVIDUAL': 'Pessoa física',
          'COMPANY': 'Pessoa jurídica',
        },
      ),
      OwnerFormField(
        'legalName',
        'Nome ou razão social',
        initial: row['legalName'],
        required: true,
        maxLength: 255,
      ),
      OwnerFormField(
        'tradeName',
        'Nome fantasia',
        initial: row['tradeName'],
        maxLength: 255,
      ),
      OwnerFormField(
        'documentNumber',
        'CPF ou CNPJ',
        initial: row['documentNumber'],
        keyboard: TextInputType.number,
        maxLength: 18,
      ),
      OwnerFormField(
        'email',
        'E-mail',
        initial: row['email'],
        keyboard: TextInputType.emailAddress,
        maxLength: 320,
      ),
      OwnerFormField(
        'phone',
        'Telefone',
        initial: row['phone'],
        keyboard: TextInputType.phone,
        maxLength: 32,
      ),
      OwnerFormField(
        'notes',
        'Observações',
        initial: row['notes'],
        lines: 3,
        maxLength: 2000,
      ),
      if (current != null)
        OwnerFormField(
          'status',
          'Situação',
          initial: row['status'],
          choices: const {
            'ACTIVE': 'Ativo',
            'INACTIVE': 'Inativo',
            'PROSPECT': 'Prospecto',
            'BLOCKED': 'Bloqueado',
          },
        ),
    ],
    save: (values, _) async {
      final input = Map<String, dynamic>.of(values)
        ..removeWhere((key, value) => value == null);
      if (input.containsKey('documentNumber')) {
        input['documentType'] = input['type'] == 'COMPANY' ? 'CNPJ' : 'CPF';
      }
      if (current == null) {
        await tools.repo.post('/customers', input);
      } else {
        await tools.repo.update('/customers/${ownerId(row)}', input);
      }
    },
  );
}

OwnerRecords _addresses(OwnerTools tools, OwnerRow customer) {
  final path = '/customers/${ownerId(customer)}/addresses';
  final canEdit = tools.can('customers', 'customers.update');
  return OwnerRecords(
    title: 'Endereços · ${ownerText(customer)}',
    createLabel: 'Novo endereço',
    create: canEdit ? (context) => _addressForm(context, tools, path) : null,
    load: (_, _, _) => tools.repo.list(path),
    caption: (row) => ownerText(row, ['label']),
    subtitle: (row) => [
      ownerText(row, ['street']),
      ownerText(row, ['number']),
      ownerText(row, ['city']),
    ].where((part) => part.isNotEmpty).join(' · '),
    open: !canEdit
        ? null
        : (context, row) => ownerActions(context, ownerText(row, ['label']), [
            OwnerAction(
              'Editar endereço',
              Icons.edit_outlined,
              () => _addressForm(context, tools, path, current: row),
            ),
            OwnerAction(
              'Remover endereço',
              Icons.delete_outline,
              () => tools.remove(context, '$path/${ownerId(row)}', 'endereço'),
            ),
          ]),
  );
}

Future<bool> _addressForm(
  BuildContext context,
  OwnerTools tools,
  String path, {
  OwnerRow? current,
}) {
  final row = current ?? {};
  return ownerForm(
    context,
    title: current == null ? 'Novo endereço' : 'Editar endereço',
    fields: [
      OwnerFormField(
        'label',
        'Identificação do local',
        initial: row['label'],
        required: true,
        maxLength: 120,
      ),
      OwnerFormField(
        'postalCode',
        'CEP',
        initial: row['postalCode'],
        keyboard: TextInputType.number,
        maxLength: 16,
      ),
      OwnerFormField(
        'street',
        'Rua',
        initial: row['street'],
        required: true,
        maxLength: 255,
      ),
      OwnerFormField('number', 'Número', initial: row['number'], maxLength: 30),
      OwnerFormField(
        'complement',
        'Complemento',
        initial: row['complement'],
        maxLength: 120,
      ),
      OwnerFormField(
        'district',
        'Bairro',
        initial: row['district'],
        maxLength: 120,
      ),
      OwnerFormField(
        'city',
        'Cidade',
        initial: row['city'],
        required: true,
        maxLength: 120,
      ),
      OwnerFormField(
        'stateCode',
        'UF',
        initial: row['stateCode'],
        maxLength: 2,
      ),
      OwnerFormField(
        'notes',
        'Ponto de referência',
        initial: row['notes'],
        lines: 2,
        maxLength: 400,
      ),
      OwnerFormField(
        'isPrimary',
        'Endereço principal',
        initial: row['isPrimary'] == true,
        toggle: true,
      ),
    ],
    save: (values, _) {
      final input = Map<String, dynamic>.of(values)
        ..removeWhere((_, value) => value == null);
      return current == null
          ? tools.repo.post(path, input)
          : tools.repo.update('$path/${ownerId(row)}', input);
    },
  );
}

OwnerRecords ownerEquipment(OwnerTools tools, {OwnerRow? customer}) =>
    OwnerRecords(
      title: customer == null
          ? 'Equipamentos'
          : 'Equipamentos · ${ownerText(customer)}',
      search: true,
      createLabel: 'Novo equipamento',
      create: tools.can('equipment', 'assets.create') && tools.unitId != null
          ? (context) async {
              final selected = customer ?? await tools.customer(context);
              if (selected == null || !context.mounted) return false;
              return _assetForm(context, tools, customer: selected);
            }
          : null,
      load: (search, page, _) => tools.repo.list(
        '/assets',
        query: {
          ...ownerPageQuery(search, page, unitId: tools.unitId),
          if (customer != null) 'customerId': ownerId(customer),
        },
      ),
      subtitle: (row) => [
        ownerText(row, ['identifier', 'serialNumber']),
        ownerText(ownerRow(row['customer'])),
        ownerStatus(row['status']),
      ].where((part) => part.isNotEmpty).join(' · '),
      open: (context, summary) async {
        final path = '/assets/${ownerId(summary)}';
        final row = await tools.repo.read(path);
        if (!context.mounted) return false;
        return ownerActions(
          context,
          ownerText(row),
          [
            if (tools.can('equipment', 'assets.update'))
              OwnerAction(
                'Editar equipamento',
                Icons.edit_outlined,
                () => _assetForm(context, tools, current: row),
              ),
            if (tools.can('equipment', 'assets.delete'))
              OwnerAction(
                'Remover equipamento',
                Icons.delete_outline,
                () => tools.remove(context, path, 'equipamento'),
              ),
          ],
          details: [
            ownerText(row, ['manufacturer']),
            ownerText(row, ['model']),
            ownerText(row, ['serialNumber']),
            ownerText(row, ['location']),
          ].where((part) => part.isNotEmpty).join(' · '),
        );
      },
    );

Future<bool> _assetForm(
  BuildContext context,
  OwnerTools tools, {
  OwnerRow? current,
  OwnerRow? customer,
}) {
  final row = current ?? {};
  return ownerForm(
    context,
    title: current == null
        ? 'Novo equipamento · ${ownerText(customer!)}'
        : 'Editar equipamento',
    fields: [
      OwnerFormField(
        'name',
        'Nome',
        initial: row['name'],
        required: true,
        maxLength: 180,
      ),
      OwnerFormField(
        'category',
        'Categoria',
        initial: row['category'] ?? 'EQUIPMENT',
        required: true,
        choices: const {
          'EQUIPMENT': 'Equipamento',
          'VEHICLE': 'Veículo',
          'TOOL': 'Ferramenta',
          'FACILITY': 'Instalação',
          'OTHER': 'Outro',
        },
      ),
      OwnerFormField(
        'manufacturer',
        'Fabricante',
        initial: row['manufacturer'],
        maxLength: 120,
      ),
      OwnerFormField('model', 'Modelo', initial: row['model'], maxLength: 120),
      OwnerFormField(
        'serialNumber',
        'Número de série',
        initial: row['serialNumber'],
        maxLength: 120,
      ),
      OwnerFormField(
        'location',
        'Setor ou localização',
        initial: row['location'],
        maxLength: 255,
      ),
    ],
    save: (values, _) {
      final input = Map<String, dynamic>.of(values)
        ..removeWhere((_, value) => value == null);
      return current == null
          ? tools.repo.post('/assets', {
              ...input,
              'businessUnitId': tools.unitId,
              'customerId': ownerId(customer!),
            })
          : tools.repo.update('/assets/${ownerId(row)}', input);
    },
  );
}
