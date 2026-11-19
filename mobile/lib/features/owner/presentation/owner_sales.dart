import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../core/network/orbit_interceptors.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../documents/application/document_sharing.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';
import 'owner_tools.dart';

const _methods = {
  'PIX': 'Pix',
  'CASH': 'Dinheiro',
  'DEBIT_CARD': 'Cartão de débito',
  'CREDIT_CARD': 'Cartão de crédito',
  'BANK_TRANSFER': 'Transferência',
  'BOLETO': 'Boleto',
  'OTHER': 'Outro',
};
final _brl = NumberFormat.simpleCurrency(locale: 'pt_BR', name: 'BRL');
final _quantity = NumberFormat.decimalPatternDigits(
  locale: 'pt_BR',
  decimalDigits: 3,
);

String _money(Object? value) =>
    _brl.format(num.tryParse(value?.toString() ?? '') ?? 0);
String _formatQuantity(Object? value) =>
    _quantity.format(num.tryParse(value?.toString() ?? '') ?? 0);

String _paymentLabel(Object? method, Object? installments) {
  final label = _methods[method] ?? 'Pagamento';
  final count = int.tryParse(installments?.toString() ?? '');
  return count != null && count > 1 ? '$label · $count parcelas' : label;
}

String _receivedDate(Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  return date == null ? '' : DateFormat('dd/MM/yyyy').format(date);
}

BigInt? _scaled(String value, int digits) {
  final parts = RegExp(
    r'^(\d{1,12})(?:[.,](\d{1,3}))?$',
  ).firstMatch(value.trim());
  final fraction = parts?.group(2) ?? '';
  if (parts == null || fraction.length > digits) return null;
  return BigInt.parse(parts.group(1)! + fraction.padRight(digits, '0'));
}

String _decimal(BigInt value, [int precision = 2]) {
  final digits = value.toString().padLeft(precision + 1, '0');
  final integerLength = digits.length - precision;
  return '${digits.substring(0, integerLength)}.${digits.substring(integerLength)}';
}

OwnerRecords ownerSales(OwnerTools tools, DocumentSharing sharing) =>
    OwnerRecords(
      title: 'Vendas',
      createLabel: 'Registrar venda',
      load: (_, page, _) =>
          tools.repo.list('/sales', query: {'page': page, 'limit': 20}),
      caption: (row) => ownerText(row, ['customerName']),
      subtitle: (row) => [
        ownerText(ownerRow(row['receipt']), ['code']),
        _receivedDate(row['paidOn']),
        _money(row['total']),
      ].where((part) => part.isNotEmpty).join(' · '),
      create: (context) => _newSale(context, tools, sharing),
      open: (context, row) => _openSale(context, tools, sharing, row),
    );

Future<bool> _newSale(
  BuildContext context,
  OwnerTools tools,
  DocumentSharing sharing,
) async {
  final sale = await showModalBottomSheet<OwnerRow>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    builder: (_) => FractionallySizedBox(
      heightFactor: .92,
      child: _SaleWizard(tools: tools),
    ),
  );
  if (sale == null || !context.mounted) return false;
  await _openSale(context, tools, sharing, sale);
  return true;
}

Future<bool> _openSale(
  BuildContext context,
  OwnerTools tools,
  DocumentSharing sharing,
  OwnerRow row,
) async {
  await showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => FractionallySizedBox(
      heightFactor: .78,
      child: _SaleReceipt(tools: tools, sharing: sharing, sale: row),
    ),
  );
  return true;
}

class _SaleItem {
  _SaleItem(this.product)
    : quantity =
          (num.tryParse(product['available']?.toString() ?? '') ?? 0) >= 1
          ? '1'
          : (product['available'] as String).replaceAll('.', ','),
      price = (product['salePrice'] as String?)?.replaceAll('.', ',') ?? '';

  final OwnerRow product;
  String quantity;
  String price;

  String get id => ownerId(product);
  String get name => ownerText(product);
  String get unit => ownerText(product, ['unit']);
  String get available => ownerText(product, ['available']);

  BigInt? get subtotal {
    final qty = _scaled(quantity, 3);
    final unitPrice = _scaled(price, 2);
    final stock = _scaled(available, 3);
    if (qty == null ||
        qty <= BigInt.zero ||
        unitPrice == null ||
        stock == null ||
        qty > stock) {
      return null;
    }
    return (qty * unitPrice + BigInt.from(500)) ~/ BigInt.from(1000);
  }
}

class _Payment {
  _Payment(this.method);
  String method;
  String amount = '';
  String installments = '';
}

class _SaleWizard extends StatefulWidget {
  const _SaleWizard({required this.tools});
  final OwnerTools tools;

  @override
  State<_SaleWizard> createState() => _SaleWizardState();
}

class _SaleWizardState extends State<_SaleWizard> {
  static const _steps = ['Cliente', 'Produtos', 'Pagamento', 'Revisão'];
  final _requestId = RequestContextInterceptor.newRequestId();
  final _items = <_SaleItem>[];
  final _payments = <_Payment>[_Payment('PIX')];
  late DateTime _date = widget.tools.now;
  OwnerRow? _customer;
  String _discount = '';
  String _notes = '';
  String? _error;
  bool _saving = false;
  int _step = 0;

  BigInt get _subtotal => _items.fold(
    BigInt.zero,
    (sum, item) => sum + (item.subtotal ?? BigInt.zero),
  );
  BigInt? get _rebate => _scaled(_discount.isEmpty ? '0' : _discount, 2);
  BigInt get _total => _subtotal - (_rebate ?? BigInt.zero);
  BigInt? _amount(_Payment payment) {
    if (payment.amount.isEmpty &&
        _payments.length == 1 &&
        _total > BigInt.zero) {
      return _total;
    }
    return _scaled(payment.amount, 2);
  }

  bool get _hasProducts =>
      _items.isNotEmpty &&
      _items.every((item) => item.subtotal != null) &&
      _subtotal > BigInt.zero &&
      _subtotal < BigInt.from(100000000000000);

  bool get _paid {
    if (_rebate == null || _total <= BigInt.zero) return false;
    var sum = BigInt.zero;
    for (final payment in _payments) {
      final amount = _amount(payment);
      final installments = payment.installments.isEmpty
          ? 1
          : int.tryParse(payment.installments);
      if (amount == null ||
          amount <= BigInt.zero ||
          installments == null ||
          installments < 1 ||
          installments > 24) {
        return false;
      }
      sum += amount;
    }
    return sum == _total;
  }

  bool get _canContinue => switch (_step) {
    0 => _customer != null,
    1 => _hasProducts,
    2 => _paid,
    _ => _customer != null && _hasProducts && _paid,
  };

  Future<void> _pickProduct() async {
    final tools = widget.tools;
    final row = await showModalBottomSheet<OwnerRow>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: .8,
        child: OwnerRecords(
          title: 'Selecionar produto',
          search: true,
          searchLabel: 'Buscar por nome ou SKU',
          load: (search, page, _) => tools.repo.list(
            '/sales/products',
            query: {
              'page': page,
              'limit': 20,
              if (search.isNotEmpty) 'search': search,
            },
          ),
          subtitle: (item) => [
            if ((item['sku'] as String?)?.isNotEmpty ?? false)
              item['sku'] as String,
            if (_items.any((selected) => selected.id == ownerId(item)))
              'Já incluído',
            if ((num.tryParse(ownerText(item, ['available'])) ?? 0) > 0)
              '${_quantity.format(num.parse(ownerText(item, ['available'])))} ${item['unit']} disponíveis'
            else
              'Sem estoque',
            if (item['salePrice'] != null) _money(item['salePrice']),
          ].join(' · '),
          open: (sheet, item) async {
            if (_items.any((selected) => selected.id == ownerId(item))) {
              throw const OwnerInputError(
                'Ajuste a quantidade no produto já incluído.',
              );
            }
            if ((num.tryParse(ownerText(item, ['available'])) ?? 0) <= 0) {
              throw const OwnerInputError(
                'Este produto está sem estoque na unidade.',
              );
            }
            Navigator.pop(sheet, item);
            return false;
          },
        ),
      ),
    );
    if (row != null && mounted) setState(() => _items.add(_SaleItem(row)));
  }

  Future<void> _submit() async {
    if (_saving || !_canContinue) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final sale = await widget.tools.repo.create('/sales', {
        'requestId': _requestId,
        'customerId': ownerId(_customer!),
        'paidOn': ownerDate(_date),
        'discount': _decimal(_rebate!),
        if (_notes.trim().isNotEmpty) 'notes': _notes.trim(),
        'items': [
          for (final item in _items)
            {
              'productId': item.id,
              'quantity': _decimal(_scaled(item.quantity, 3)!, 3),
              'unitPrice': _decimal(_scaled(item.price, 2)!),
            },
        ],
        'payments': [
          for (final payment in _payments)
            {
              'method': payment.method,
              'amount': _decimal(_amount(payment)!),
              if (payment.method == 'CREDIT_CARD' &&
                  payment.installments.isNotEmpty)
                'installments': int.parse(payment.installments),
            },
        ],
      });
      if (mounted) Navigator.pop(context, sale);
    } catch (error) {
      if (mounted) setState(() => _error = ownerError(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _text({
    Key? key,
    required String label,
    required String value,
    required ValueChanged<String> change,
    String? hint,
    bool numeric = true,
    int lines = 1,
    int? length,
  }) => TextFormField(
    key: key,
    initialValue: value,
    onChanged: (value) => setState(() => change(value)),
    keyboardType: numeric
        ? const TextInputType.numberWithOptions(decimal: true)
        : TextInputType.multiline,
    maxLines: lines,
    maxLength: length,
    decoration: InputDecoration(labelText: label, hintText: hint),
  );

  List<Widget> _customerFields() => [
    OutlinedButton.icon(
      onPressed: () async {
        final selected = await widget.tools.customer(context);
        if (selected != null && mounted) setState(() => _customer = selected);
      },
      icon: const Icon(Icons.person_search_outlined),
      label: Text(
        _customer == null ? 'Selecionar cliente *' : ownerText(_customer!),
      ),
    ),
    OutlinedButton.icon(
      onPressed: () async {
        final selected = await showDatePicker(
          context: context,
          initialDate: _date,
          firstDate: DateTime(2000),
          lastDate: widget.tools.now,
        );
        if (selected != null && mounted) setState(() => _date = selected);
      },
      icon: const Icon(Icons.event_outlined),
      label: Text('Recebimento · ${DateFormat('dd/MM/yyyy').format(_date)}'),
    ),
    _text(
      label: 'Observações',
      value: _notes,
      change: (value) => _notes = value,
      numeric: false,
      lines: 3,
      length: 500,
    ),
  ];

  List<Widget> _productFields() => [
    OutlinedButton.icon(
      onPressed: _items.length < 20 ? _pickProduct : null,
      icon: const Icon(Icons.add),
      label: const Text('Adicionar produto'),
    ),
    if (_items.isEmpty)
      const Text('Selecione os produtos vendidos nesta unidade.'),
    for (final item in _items)
      Card(
        key: ValueKey(item.id),
        child: Padding(
          padding: const EdgeInsets.all(OrbitSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      item.name,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Remover ${item.name}',
                    onPressed: () => setState(() => _items.remove(item)),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
              Text(
                '${_quantity.format(num.tryParse(item.available) ?? 0)} ${item.unit} em estoque',
              ),
              const SizedBox(height: OrbitSpacing.md),
              Row(
                children: [
                  Expanded(
                    child: _text(
                      label: 'Quantidade *',
                      value: item.quantity,
                      change: (value) => item.quantity = value,
                    ),
                  ),
                  const SizedBox(width: OrbitSpacing.sm),
                  Expanded(
                    child: _text(
                      label: 'Valor unitário *',
                      value: item.price,
                      change: (value) => item.price = value,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.sm),
              Text(
                item.subtotal == null
                    ? 'Confira a quantidade e o valor.'
                    : _money(_decimal(item.subtotal!)),
              ),
            ],
          ),
        ),
      ),
  ];

  List<Widget> _paymentFields() => [
    _text(
      label: 'Desconto em reais',
      value: _discount,
      change: (value) => _discount = value,
      hint: '0,00',
    ),
    _summaryLine(
      'Total a receber',
      _total > BigInt.zero ? _money(_decimal(_total)) : '—',
    ),
    for (final payment in _payments)
      Card(
        key: ObjectKey(payment),
        child: Padding(
          padding: const EdgeInsets.all(OrbitSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: payment.method,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Forma de pagamento *',
                      ),
                      items: [
                        for (final method in _methods.entries)
                          DropdownMenuItem(
                            value: method.key,
                            child: Text(method.value),
                          ),
                      ],
                      onChanged: (value) => setState(() {
                        payment.method = value ?? 'PIX';
                        payment.installments = '';
                      }),
                    ),
                  ),
                  if (_payments.length > 1)
                    IconButton(
                      tooltip: 'Remover pagamento',
                      onPressed: () =>
                          setState(() => _payments.remove(payment)),
                      icon: const Icon(Icons.delete_outline),
                    ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.md),
              _text(
                label: _payments.length == 1
                    ? 'Valor recebido'
                    : 'Valor recebido *',
                value: payment.amount,
                change: (value) => payment.amount = value,
                hint: _payments.length == 1 && _total > BigInt.zero
                    ? _decimal(_total).replaceAll('.', ',')
                    : '0,00',
              ),
              if (payment.method == 'CREDIT_CARD') ...[
                const SizedBox(height: OrbitSpacing.md),
                _text(
                  label: 'Parcelas',
                  value: payment.installments,
                  change: (value) => payment.installments = value,
                  hint: '1',
                ),
              ],
            ],
          ),
        ),
      ),
    if (_payments.length < 5)
      OutlinedButton.icon(
        onPressed: () => setState(() => _payments.add(_Payment('CASH'))),
        icon: const Icon(Icons.add),
        label: const Text('Adicionar forma de pagamento'),
      ),
    if (!_paid)
      const Text(
        'Confira o desconto e informe pagamentos cuja soma seja igual ao total.',
      ),
  ];

  List<Widget> _review() => [
    Text(ownerText(_customer!), style: Theme.of(context).textTheme.titleMedium),
    Text('Recebido em ${DateFormat('dd/MM/yyyy').format(_date)}'),
    for (final item in _items)
      _summaryLine(
        '${item.quantity} ${item.unit} · ${item.name}',
        _money(_decimal(item.subtotal!)),
      ),
    const Divider(),
    if (_rebate! > BigInt.zero)
      _summaryLine('Desconto', _money(_decimal(_rebate!))),
    _summaryLine('Total recebido', _money(_decimal(_total))),
    for (final payment in _payments)
      _summaryLine(
        _paymentLabel(payment.method, payment.installments),
        _money(_decimal(_amount(payment)!)),
      ),
    if (_notes.trim().isNotEmpty) Text('Observações: ${_notes.trim()}'),
    const Text(
      'Confirme somente após receber o pagamento. A venda baixa o estoque da unidade e emite um recibo com a assinatura cadastrada no seu perfil.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final fields = switch (_step) {
      0 => _customerFields(),
      1 => _productFields(),
      2 => _paymentFields(),
      _ => _review(),
    };
    return PopScope(
      canPop: !_saving,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          children: [
            ListTile(
              title: const Text('Registrar venda'),
              subtitle: Text(
                [
                  '${_steps[_step]} · Etapa ${_step + 1} de ${_steps.length}',
                  ?widget.tools.session.businessUnit?.name,
                ].join(' · '),
              ),
              trailing: IconButton(
                onPressed: _saving ? null : () => Navigator.pop(context),
                icon: const Icon(Icons.close),
                tooltip: 'Fechar',
              ),
            ),
            Padding(
              padding: ownerPadding,
              child: LinearProgressIndicator(
                value: (_step + 1) / _steps.length,
              ),
            ),
            Expanded(
              child: ListView.separated(
                key: ValueKey(_step),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: ownerPadding,
                itemBuilder: (_, index) => fields[index],
                separatorBuilder: (_, _) =>
                    const SizedBox(height: OrbitSpacing.sm),
                itemCount: fields.length,
              ),
            ),
            if (_error case final message?)
              Padding(
                padding: ownerPadding,
                child: Text(
                  message,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            SafeArea(
              top: false,
              minimum: ownerPadding,
              child: Row(
                children: [
                  if (_step > 0)
                    TextButton(
                      onPressed: _saving
                          ? null
                          : () => setState(() {
                              _step--;
                              _error = null;
                            }),
                      child: const Text('Voltar'),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: !_canContinue || _saving
                        ? null
                        : () {
                            FocusScope.of(context).unfocus();
                            if (_step == _steps.length - 1) {
                              unawaited(_submit());
                            } else {
                              setState(() => _step++);
                            }
                          },
                    child: Text(
                      _saving
                          ? 'Registrando…'
                          : _step == _steps.length - 1
                          ? 'Confirmar venda'
                          : 'Avançar',
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Widget _summaryLine(String label, String value) => Padding(
  padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.xs),
  child: Row(
    children: [
      Expanded(child: Text(label)),
      const SizedBox(width: OrbitSpacing.sm),
      Text(value),
    ],
  ),
);

class _SaleReceipt extends StatefulWidget {
  const _SaleReceipt({
    required this.tools,
    required this.sharing,
    required this.sale,
  });
  final OwnerTools tools;
  final DocumentSharing sharing;
  final OwnerRow sale;

  @override
  State<_SaleReceipt> createState() => _SaleReceiptState();
}

class _SaleReceiptState extends State<_SaleReceipt> {
  late OwnerRow _sale = widget.sale;
  Timer? _timer;
  bool _busy = false;
  String? _error;

  String get _path => '/sales/${ownerId(_sale)}';
  String? get _status => ownerRow(_sale['receipt'])['renderStatus'] as String?;
  bool get _pending => const ['PENDING', 'RENDERING'].contains(_status);

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    if (_pending) {
      _timer = Timer(const Duration(seconds: 3), () => unawaited(_refresh()));
    }
  }

  Future<void> _refresh() async {
    try {
      final updated = await widget.tools.repo.read(_path);
      if (!mounted) return;
      setState(() {
        _sale = updated;
        _error = null;
      });
      _schedule();
    } catch (error) {
      if (mounted) setState(() => _error = ownerError(error));
    }
  }

  Future<void> _retry() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.tools.repo.post('$_path/receipt');
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = ownerError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _share() async {
    final box = context.findRenderObject();
    final origin = box is RenderBox && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : null;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await for (final state in widget.sharing.shareWith(
        access: () async => FieldArtifactAccess.fromJson({
          ...await widget.tools.repo.read('$_path/receipt/download'),
          'artifactId': ownerId(_sale),
          'operation': 'download',
        }),
        fileName: 'recibo-${ownerRow(_sale['receipt'])['code']}.pdf',
        subject: 'Recibo de venda',
        origin: origin,
      )) {
        if (state.phase == SharePhase.error) {
          throw state.error ??
              const OwnerInputError('Não foi possível abrir o recibo.');
        }
      }
    } catch (error) {
      if (mounted) setState(() => _error = ownerError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final code = ownerRow(_sale['receipt'])['code'];
    return ListView(
      padding: ownerPadding,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.check_circle_outline),
          title: Text('Venda registrada · $code'),
          subtitle: Text(ownerText(_sale, ['customerName'])),
        ),
        Text('Recebido em ${_receivedDate(_sale['paidOn'])}'),
        const SizedBox(height: OrbitSpacing.md),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(OrbitSpacing.md),
            child: Column(
              children: [
                for (final line in ownerRows(_sale['items']))
                  _summaryLine(
                    '${_formatQuantity(line['quantity'])} ${line['unit']} · ${line['name']}',
                    _money(line['total']),
                  ),
                if ((num.tryParse(_sale['discount']?.toString() ?? '') ?? 0) >
                    0)
                  _summaryLine('Desconto', _money(_sale['discount'])),
                const Divider(),
                _summaryLine('Total recebido', _money(_sale['total'])),
              ],
            ),
          ),
        ),
        for (final payment in ownerRows(_sale['payments']))
          _summaryLine(
            _paymentLabel(payment['method'], payment['installments']),
            _money(payment['amount']),
          ),
        if ((_sale['notes'] as String?)?.isNotEmpty ?? false)
          Text(_sale['notes'] as String),
        const SizedBox(height: OrbitSpacing.md),
        if (_status == 'READY')
          FilledButton.icon(
            onPressed: _busy ? null : _share,
            icon: const Icon(Icons.ios_share),
            label: Text(
              _busy ? 'Preparando PDF…' : 'Compartilhar ou salvar recibo',
            ),
          )
        else if (_pending && _error == null) ...[
          const LinearProgressIndicator(),
          const SizedBox(height: OrbitSpacing.sm),
          const Text('Gerando o recibo da venda…'),
        ] else if (_pending)
          OutlinedButton(
            onPressed: _refresh,
            child: const Text('Consultar recibo'),
          )
        else
          OutlinedButton(
            onPressed: _busy ? null : _retry,
            child: Text(
              _busy ? 'Solicitando…' : 'Tentar gerar recibo novamente',
            ),
          ),
        if (_error case final message?)
          Text(
            message,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
      ],
    );
  }
}
