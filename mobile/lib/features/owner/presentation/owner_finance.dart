import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/design/orbit_primitives.dart';

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../documents/application/document_sharing.dart';
import '../../customers/presentation/new_quote_sheet.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_style.dart';
import 'owner_tools.dart';

Future<bool> ownerQuote(BuildContext context, OwnerTools tools) async {
  final customer = await tools.customer(context);
  if (customer == null || !context.mounted) return false;
  return showNewQuoteSheet(
    context,
    MobileFieldCustomerContract(
      id: ownerId(customer),
      name: ownerText(customer),
      legalName: ownerText(customer, ['legalName']),
      openCount: 0,
      completedCount: 0,
    ),
  );
}

OwnerRecords ownerReceipts(OwnerTools tools, DocumentSharing sharing) =>
    OwnerRecords(
      title: 'Recibos',
      createLabel: 'Novo recibo',
      create: tools.unitId == null
          ? null
          : (context) => _receiptForm(context, tools),
      load: (_, page, _) => tools.repo.list(
        '/financial/receipts',
        query: ownerPageQuery('', page, unitId: tools.unitId),
      ),
      icon: Icons.receipt_long_outlined,
      badge: _receiptBadge,
      subtitle: (row) => [
        ownerText(row, ['code']),
        ownerInstant(tools.zone, ownerString(row, 'createdAt')),
      ].where((part) => part.isNotEmpty).join(' · '),
      open: (context, row) => _receiptActions(context, tools, sharing, row),
    );

String? _moneyOf(Object? value) {
  final amount = num.tryParse(value?.toString() ?? '');
  return amount == null
      ? null
      : NumberFormat.currency(locale: 'pt_BR', symbol: r'R$').format(amount);
}

OwnerBadgeData? _receiptBadge(OwnerRow row) => switch (row['renderStatus']) {
  'READY' => (label: 'PDF disponível', tone: OrbitTone.success),
  'PENDING' || 'RENDERING' => (label: 'Gerando PDF', tone: OrbitTone.warning),
  'FAILED' => (label: 'Falha ao gerar PDF', tone: OrbitTone.danger),
  _ => ownerBadge(row),
};

Future<bool> _receiptActions(
  BuildContext context,
  OwnerTools tools,
  DocumentSharing sharing,
  OwnerRow row,
) {
  final id = ownerId(row);
  final path = '/financial/receipts/$id';
  final renderStatus = row['renderStatus'];
  return ownerActions(
    context,
    ownerText(row),
    [
      if (const ['PENDING', 'RENDERING'].contains(renderStatus))
        OwnerAction('Consultar PDF', Icons.refresh, () async => true)
      else if (renderStatus == 'READY' &&
          tools.can('receipts', 'artifact_manifests.read'))
        OwnerAction('Compartilhar ou salvar PDF', Icons.ios_share, () async {
          final box = context.findRenderObject();
          final origin = box is RenderBox && box.hasSize
              ? box.localToGlobal(Offset.zero) & box.size
              : null;
          await for (final state in sharing.shareWith(
            access: () async => FieldArtifactAccess.fromJson({
              ...await tools.repo.read('$path/download'),
              'artifactId': id,
              'operation': 'download',
            }),
            fileName: 'recibo-${row['code']}.pdf',
            subject: ownerText(row),
            origin: origin,
          )) {
            if (state.phase == SharePhase.error) {
              throw state.error ??
                  const OwnerInputError(
                    'Não foi possível compartilhar o recibo.',
                  );
            }
          }
          return false;
        })
      else if (tools.can('receipts', 'artifact_rendering.render'))
        OwnerAction('Gerar PDF', Icons.picture_as_pdf_outlined, () async {
          if (!await ownerConfirm(
            context,
            'Gerar PDF do recibo?',
            'Confirme que recebeu o pagamento. O Orbit usará sua assinatura do Perfil se o modelo exigir.',
            label: 'Confirmar e gerar PDF',
          )) {
            return false;
          }
          await tools.repo.post('$path/render');
          return true;
        }),
    ],
    icon: Icons.receipt_long_outlined,
    eyebrow: 'Recibo',
    badge: _receiptBadge(row),
    facts: [
      ('Número', ownerText(row, ['code'])),
      ('Emitido em', ownerInstant(tools.zone, ownerString(row, 'createdAt'))),
    ],
  );
}

Future<bool> _receiptForm(BuildContext context, OwnerTools tools) async {
  final selection = await tools.pickCustomer(
    context,
    alternative: 'Preencher dados de novo cliente',
  );
  if (selection == null || !context.mounted) return false;
  final customer = selection.value;

  return ownerForm(
    context,
    title: 'Novo recibo',
    action: 'Criar recibo',
    zone: tools.zone,
    fields: [
      OwnerFormField(
        'payer',
        'Nome de quem pagou',
        required: true,
        maxLength: 180,
        initial: customer == null ? null : ownerText(customer),
      ),
      OwnerFormField(
        'payerDocument',
        'CPF ou CNPJ do pagador',
        maxLength: 40,
        keyboard: TextInputType.number,
        initial: customer?['documentNumber'],
      ),
      const OwnerFormField(
        'amount',
        r'Valor (R$)',
        required: true,
        numeric: true,
      ),
      OwnerFormField(
        'paidOn',
        'Data do recebimento',
        required: true,
        initial: tools.now,
        date: true,
      ),
      const OwnerFormField(
        'referring',
        'Referente a',
        required: true,
        lines: 3,
        maxLength: 2000,
      ),
      const OwnerFormField(
        'paymentMethod',
        'Forma de pagamento',
        choices: {
          'Pix': 'Pix',
          'Dinheiro': 'Dinheiro',
          'Cartão': 'Cartão',
          'Transferência': 'Transferência',
          'Boleto': 'Boleto',
        },
      ),
    ],
    save: (values, _) {
      final paidOn = isoDate(values, 'paidOn')!;
      final amount = decimalText(values, 'amount')!;
      if (paidOn.compareTo(ownerDate(tools.now)) > 0) {
        throw const OwnerInputError(
          'A data de recebimento deve ser hoje ou anterior.',
        );
      }
      if (double.parse(amount) <= 0) {
        throw const OwnerInputError('Informe um valor maior que zero.');
      }
      return tools.repo.post('/financial/receipts', {
        'businessUnitId': tools.unitId,
        'payer': values['payer'],
        'amount': amount,
        'paidOn': paidOn,
        'referring': values['referring'],
        if (values['payerDocument'] case final String document)
          'payerDocument': document,
        if (values['paymentMethod'] case final String method)
          'paymentMethod': method,
        if (customer != null) 'customerId': ownerId(customer),
      });
    },
  );
}

OwnerRecords ownerFinance(OwnerTools tools) => OwnerRecords(
  title: 'Entradas e saídas',
  search: true,
  createLabel: 'Novo lançamento',
  create: tools.can('finance', 'financial.manage') && tools.unitId != null
      ? (context) => ownerActions(
          context,
          'Novo lançamento',
          icon: Icons.account_balance_wallet_outlined,
          subtitle: 'O que você quer registrar?',
          [
            OwnerAction(
              'Registrar entrada',
              Icons.south_west,
              () => _entryForm(context, tools, 'INCOME'),
            ),
            OwnerAction(
              'Registrar saída',
              Icons.north_east,
              () => _entryForm(context, tools, 'EXPENSE'),
            ),
          ],
        )
      : null,
  load: (search, page, _) => tools.repo.list(
    '/financial/entries',
    query: ownerPageQuery(search, page, unitId: tools.unitId),
  ),
  iconOf: (row) => row['type'] == 'INCOME'
      ? Icons.south_west_rounded
      : Icons.north_east_rounded,
  toneOf: (row) =>
      row['type'] == 'INCOME' ? OrbitTone.success : OrbitTone.warning,
  amount: (row) => _moneyOf(row['amount']),
  subtitle: (row) => _entryCaption(row),
  open: (context, row) => _entryActions(context, tools, row),
);

String _entryCaption(OwnerRow row) {
  final amount = num.tryParse(ownerString(row, 'amount') ?? '');
  return [
    row['type'] == 'INCOME' ? 'Entrada' : 'Saída',
    if (amount != null)
      NumberFormat.currency(locale: 'pt_BR', symbol: r'R$').format(amount),
    ownerStatus(row['status']),
    ownerDateLabel(
      ownerString(row, 'dueDate') ?? ownerString(row, 'competenceDate'),
    ),
  ].where((part) => part.isNotEmpty).join(' · ');
}

Future<bool> _entryActions(
  BuildContext context,
  OwnerTools tools,
  OwnerRow row,
) {
  final path = '/financial/entries/${ownerId(row)}';
  final manage = tools.can('finance', 'financial.manage');
  return ownerActions(
    context,
    ownerText(row),
    [
      if (manage && row['status'] == 'PENDING')
        OwnerAction(
          'Confirmar lançamento',
          Icons.check_circle_outline,
          () async {
            if (!await ownerConfirm(
              context,
              'Confirmar lançamento?',
              'O valor será registrado como realizado.',
            )) {
              return false;
            }
            await tools.repo.post('$path/confirm');
            return true;
          },
        ),
      if (manage &&
          row['status'] != 'CANCELLED' &&
          ownerRow(row['origin'])['source'] == 'MANUAL') ...[
        OwnerAction(
          'Editar lançamento',
          Icons.edit_outlined,
          () => _entryForm(context, tools, row['type'] as String, current: row),
        ),
        OwnerAction(
          'Cancelar lançamento',
          Icons.cancel_outlined,
          () => ownerForm(
            context,
            title: 'Cancelar lançamento',
            action: 'Confirmar cancelamento',
            fields: const [
              OwnerFormField(
                'reason',
                'Motivo',
                required: true,
                lines: 3,
                maxLength: 500,
              ),
            ],
            save: (values, _) =>
                tools.repo.post('$path/cancel', {'reason': values['reason']}),
          ),
        ),
      ],
    ],
    icon: row['type'] == 'INCOME'
        ? Icons.south_west_rounded
        : Icons.north_east_rounded,
    tone: row['type'] == 'INCOME' ? OrbitTone.success : OrbitTone.warning,
    eyebrow: row['type'] == 'INCOME' ? 'Entrada' : 'Saída',
    badge: ownerBadge(row),
    facts: [
      ('Valor', _moneyOf(row['amount'])),
      ('Vencimento', ownerDateLabel(ownerString(row, 'dueDate'))),
      ('Competência', ownerDateLabel(ownerString(row, 'competenceDate'))),
      ('Categoria', ownerText(ownerRow(row['category']))),
      ('Observações', ownerText(row, ['notes'])),
    ],
  );
}

Future<bool> _entryForm(
  BuildContext context,
  OwnerTools tools,
  String type, {
  OwnerRow? current,
}) {
  final row = current ?? {};
  return ownerForm(
    context,
    title: current != null
        ? 'Editar lançamento'
        : type == 'INCOME'
        ? 'Nova entrada'
        : 'Nova saída',
    zone: tools.zone,
    fields: [
      OwnerFormField(
        'description',
        'Descrição',
        required: true,
        initial: row['description'],
      ),
      OwnerFormField(
        'amount',
        r'Valor (R$)',
        required: true,
        numeric: true,
        initial: row['amount'],
      ),
      OwnerFormField(
        'competenceDate',
        'Data de competência',
        date: true,
        required: true,
        initial:
            DateTime.tryParse(ownerString(row, 'competenceDate') ?? '') ??
            tools.now,
      ),
      OwnerFormField(
        'dueDate',
        'Vencimento',
        date: true,
        initial: DateTime.tryParse(ownerString(row, 'dueDate') ?? ''),
      ),
      OwnerFormField(
        'category',
        'Categoria',
        initial: rowOrNull(row['category']),
        pick: (search) async => (await tools.repo.options(
          '/financial/categories',
          query: {'type': type},
        )).where((row) => matches(row, search)).toList(),
      ),
      if (current == null)
        OwnerFormField(
          'customer',
          'Cliente',
          select: (context) =>
              tools.pickCustomer(context, alternative: 'Sem cliente vinculado'),
        ),
      OwnerFormField(
        'notes',
        'Observações',
        initial: row['notes'],
        lines: 3,
        maxLength: 2000,
      ),
      if (current == null)
        const OwnerFormField('confirmed', 'Já realizado', toggle: true),
    ],
    save: (values, _) {
      final input = {
        'description': values['description'],
        'amount': double.parse(decimalText(values, 'amount')!),
        'competenceDate': isoDate(values, 'competenceDate'),
        if (isoDate(values, 'dueDate') case final due?) 'dueDate': due,
        if (pickId(values['category']) case final category?)
          'categoryId': category,
        if (values['notes'] case final String notes) 'notes': notes,
      };
      return current == null
          ? tools.repo.post('/financial/entries', {
              ...input,
              'type': type,
              'businessUnitId': tools.unitId,
              if (pickId(values['customer']) case final customer?)
                'customerId': customer,
              if (values['confirmed'] == true) 'status': 'CONFIRMED',
            })
          : tools.repo.update('/financial/entries/${ownerId(row)}', input);
    },
  );
}
