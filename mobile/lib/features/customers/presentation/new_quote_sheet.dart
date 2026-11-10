/// Native commercial wizard, aligned with the web wizard and its QuoteService.
library;

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_signature_pad.dart';
import '../../../core/design/orbit_wizard.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/time/civil_time.dart';
import '../../artifact/application/artifact_providers.dart';
import '../application/customer_write_providers.dart';
import '../data/customer_write_repository.dart';

Future<bool> showNewQuoteSheet(
  BuildContext context,
  MobileFieldCustomerContract cliente,
) async {
  return await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => _QuoteWizard(cliente: cliente)),
      ) ??
      false;
}

class _QuoteWizard extends ConsumerStatefulWidget {
  const _QuoteWizard({required this.cliente});
  final MobileFieldCustomerContract cliente;
  @override
  ConsumerState<_QuoteWizard> createState() => _QuoteWizardState();
}

class _QuoteWizardState extends ConsumerState<_QuoteWizard> {
  final _title = TextEditingController();
  final _notes = TextEditingController();
  final _intro = TextEditingController();
  final _discount = TextEditingController(text: '0');
  final _discountReason = TextEditingController();
  final _signer = TextEditingController();
  final _signature = OrbitSignatureController();
  final _lines = <QuoteLine>[];
  final _assetIds = <String>{};
  final _wizard = GlobalKey<OrbitWizardState>();
  final _requestId =
      'quote-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';
  DateTime _validUntil = DateTime.now().add(const Duration(days: 30));
  String? _addressId;
  String? _responsibleId;
  String? _token;
  String? _error;
  bool _busy = false;
  bool _reviewed = false;
  bool _signing = false;
  bool _consent = false;
  bool _approved = false;
  Map<String, dynamic>? _submission;
  Map<String, dynamic>? _quote;

  @override
  void initState() {
    super.initState();
    for (final controller in [
      _title,
      _notes,
      _intro,
      _discount,
      _discountReason,
    ]) {
      controller.addListener(_draftChanged);
    }
  }

  void _draftChanged() {
    if (mounted) setState(() => _reviewed = false);
  }

  @override
  void dispose() {
    for (final c in [
      _title,
      _notes,
      _intro,
      _discount,
      _discountReason,
      _signer,
    ]) {
      c.dispose();
    }
    _signature.dispose();
    super.dispose();
  }

  double get _subtotal =>
      _lines.fold(0, (sum, line) => sum + (line.total * 100).round() / 100);
  double? get _discountValue {
    final value = double.tryParse(_discount.text.replaceAll(',', '.'));
    return value != null && value.isFinite ? value : null;
  }

  double get _total => _subtotal - (_discountValue ?? 0);
  List<Map<String, dynamic>> _rows(Map<String, dynamic> data, String key) =>
      (data[key] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();

  void _showError(Object error) {
    if (mounted) {
      setState(() => _error = OrbitException.publicCopyForAny(error));
    }
  }

  Future<void> _create() async {
    if (_busy || !_reviewed) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobileQuoteRepositoryProvider);
      _submission ??= {
        'requestId': _requestId,
        'customerId': widget.cliente.id,
        'title': _title.text.trim(),
        'notes': _notes.text.trim(),
        if (_intro.text.trim().isNotEmpty) 'introText': _intro.text.trim(),
        'validUntil': _validUntil.toIso8601String().substring(0, 10),
        'responsibleUserId': _responsibleId,
        if (ref.read(sessionProvider)?.businessUnitId case final id?)
          'businessUnitId': id,
        if (_addressId != null) 'serviceAddressId': _addressId,
        'assetIds': _assetIds.toList(),
        'discount': _discountValue ?? 0,
        'discountReason': _discountReason.text.trim(),
        'items': _lines
            .map(
              (line) => {
                'description': line.description.trim(),
                'quantity': line.quantity,
                'unitPrice': line.unitPrice,
                'unit': line.unit ?? 'UN',
                if (line.catalogItemId != null)
                  'catalogItemId': line.catalogItemId,
              },
            )
            .toList(),
      };
      final result = await repository.create(_submission!);
      repository.checkSession();
      if (mounted) setState(() => _quote = result);
    } on Object catch (error) {
      // Validation failure rolls back the whole transaction; permit corrections.
      // An uncertain network result keeps the exact payload and request id.
      if (error is OrbitException &&
          [400, 403, 404, 422].contains(error.status)) {
        _submission = null;
      }
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approve() async {
    if (_busy ||
        !_consent ||
        !_signature.temTraco ||
        _signer.text.trim().length < 3) {
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobileQuoteRepositoryProvider);
      final png = await _signature.exportar();
      if (png == null) return;
      _token ??= await repository.acceptanceLink(_quote!['id'] as String);
      await repository.approve(_token!, name: _signer.text, signature: png);
      repository.checkSession();
      if (mounted) {
        setState(() {
          _approved = true;
          _signing = false;
        });
      }
    } on Object catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _share() async {
    if (_busy) return;
    final box = context.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobileQuoteRepositoryProvider);
      final path = await repository.document(
        _quote!['id'] as String,
        ref.read(documentFileStoreProvider),
      );
      repository.checkSession();
      if (!mounted) return;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(path, mimeType: 'application/pdf')],
          subject: 'Orçamento ${_quote!['code']}',
          sharePositionOrigin: origin,
        ),
      );
    } on Object catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addLine({Map<String, dynamic>? catalog}) async {
    final line = await showModalBottomSheet<QuoteLine>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.orbit.background,
      builder: (context) => SingleChildScrollView(
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: _FolhaDeLinha(catalog: catalog),
        ),
      ),
    );
    if (line != null && mounted) {
      setState(() {
        _lines.add(line);
        _reviewed = false;
      });
    }
  }

  Future<void> _pickCatalog() async {
    final item = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _CatalogPicker(),
    );
    if (item != null && mounted) await _addLine(catalog: item);
  }

  String? _issue(int step) => switch (step) {
    0 when _title.text.trim().length < 3 =>
      'Informe um título com pelo menos 3 caracteres.',
    1 when _lines.isEmpty => 'Adicione ao menos um serviço ou material.',
    2
        when _discountValue == null ||
            !_discountValue!.isFinite ||
            _discountValue! > 999999999.99 ||
            (_discountValue! * 100).round() / 100 != _discountValue ||
            _discountValue! < 0 ||
            _discountValue! > _subtotal ||
            _total <= 0 =>
      'Informe um desconto válido. O total precisa ser maior que zero.',
    3 when _responsibleId == null =>
      'Selecione o responsável técnico pela proposta.',
    _ => null,
  };

  Widget _section(String title, IconData icon, List<Widget> children) =>
      OrbitCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: context.orbit.accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: OrbitType.itemTitle.copyWith(
                      color: context.orbit.ink,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: OrbitSpacing.md),
            ...children,
          ],
        ),
      );

  Widget _summary() {
    final options =
        ref.read(mobileQuoteOptionsProvider(widget.cliente.id)).valueOrNull ??
        <String, dynamic>{};
    final addresses = _rows(
      options,
      'addresses',
    ).where((a) => a['id'] == _addressId);
    final responsibles = _rows(
      options,
      'responsibles',
    ).where((m) => m['id'] == _responsibleId);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _section('Cliente e proposta', Icons.person_outline, [
          Text(widget.cliente.name, style: OrbitType.itemTitle),
          const SizedBox(height: 6),
          Text(_title.text),
          Text(
            'Válido até ${OrbitFormat.shortDate(CivilDate(_validUntil.year, _validUntil.month, _validUntil.day))}',
          ),
          if (addresses.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.ms),
            Text(
              '${addresses.first['label']}: ${addresses.first['street']}, ${addresses.first['number'] ?? 's/n'} · ${addresses.first['city']}',
            ),
          ],
          if (responsibles.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.ms),
            Text('Responsável técnico: ${responsibles.first['name']}'),
          ],
          for (final equipment in _rows(
            options,
            'equipment',
          ).where((e) => _assetIds.contains(e['id']))) ...[
            const SizedBox(height: 6),
            Text('Equipamento: ${equipment['name']}'),
          ],
          if (_intro.text.trim().isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.ms),
            Text(_intro.text.trim()),
          ],
        ]),
        const SizedBox(height: OrbitSpacing.md),
        _section('Serviços e materiais', Icons.receipt_long_outlined, [
          for (final line in _lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                '${line.description}\n${OrbitFormat.number(line.quantity)} × ${OrbitFormat.currency(line.unitPrice)} = ${OrbitFormat.currency(line.total)}',
              ),
            ),
          Text('Desconto: ${OrbitFormat.currency(_discountValue ?? 0)}'),
          const Divider(),
          Text(
            'Total: ${_quote?['total'] != null ? OrbitFormat.currency(double.parse(_quote!['total'].toString())) : OrbitFormat.currency(_total)}',
            style: OrbitType.itemTitle,
          ),
        ]),
        if (_notes.text.trim().isNotEmpty) ...[
          const SizedBox(height: OrbitSpacing.md),
          _section('Observações', Icons.notes_rounded, [
            Text(_notes.text.trim()),
          ]),
        ],
      ],
    );
  }

  Widget _completed() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _section(
        _approved ? 'Orçamento aprovado e assinado' : 'Orçamento gerado',
        _approved ? Icons.verified_outlined : Icons.check_circle_outline,
        [
          Text(
            '${_quote!['code']} · ${_approved ? 'Aprovado pelo cliente' : 'Aguardando a decisão do cliente'}',
          ),
          const SizedBox(height: 8),
          const Text(
            'Este orçamento já está disponível na web, em Financeiro → Orçamentos, para acompanhamento pela gestão.',
          ),
        ],
      ),
      const SizedBox(height: OrbitSpacing.md),
      _summary(),
      if (!_approved) ...[
        const SizedBox(height: OrbitSpacing.md),
        OutlinedButton.icon(
          onPressed: _busy ? null : () => setState(() => _signing = !_signing),
          icon: const Icon(Icons.draw_outlined),
          label: Text(
            _signing
                ? 'Coletar assinatura depois'
                : 'Coletar assinatura e aprovação agora',
          ),
        ),
      ],
      if (_signing && !_approved) ...[
        const SizedBox(height: OrbitSpacing.md),
        _section('Confirmação do cliente', Icons.fact_check_outlined, [
          const Text(
            'Confira os serviços e valores acima. A assinatura e a confirmação aprovam esta proposta.',
          ),
          const SizedBox(height: OrbitSpacing.md),
          TextField(
            controller: _signer,
            enabled: !_busy,
            maxLength: 180,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Nome completo de quem assina *',
            ),
          ),
          const SizedBox(height: OrbitSpacing.ms),
          ListenableBuilder(
            listenable: _signature,
            builder: (_, _) => Column(
              children: [
                OrbitSignaturePad(
                  controller: _signature,
                  height: 200,
                  enabled: !_busy,
                ),
                TextButton(
                  onPressed: _busy ? null : _signature.limpar,
                  child: const Text('Limpar assinatura'),
                ),
              ],
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _consent,
            onChanged: _busy
                ? null
                : (v) => setState(() => _consent = v ?? false),
            title: const Text(
              'Li a proposta e autorizo os serviços e valores apresentados.',
            ),
          ),
          ListenableBuilder(
            listenable: _signature,
            builder: (_, _) => FilledButton.icon(
              onPressed:
                  !_busy &&
                      _consent &&
                      _signature.temTraco &&
                      _signer.text.trim().length >= 3
                  ? _approve
                  : null,
              icon: const Icon(Icons.verified_outlined),
              label: const Text('Assinar e aprovar orçamento'),
            ),
          ),
        ]),
      ],
      const SizedBox(height: OrbitSpacing.md),
      FilledButton.icon(
        onPressed: _busy ? null : _share,
        icon: const Icon(Icons.ios_share),
        label: Text(
          _approved
              ? 'Compartilhar PDF assinado'
              : 'Compartilhar PDF com o cliente',
        ),
      ),
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(true),
        child: const Text('Concluir'),
      ),
    ],
  );

  Widget _wizardContent(Map<String, dynamic> options) {
    final members = _rows(options, 'responsibles');
    final sessionUserId = ref.read(sessionProvider)?.user.id;
    _responsibleId ??= members.any((m) => m['id'] == sessionUserId)
        ? sessionUserId
        : null;
    return OrbitWizard(
      key: _wizard,
      preserveStepState: true,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: OrbitSpacing.gutter,
      ),
      onBeforeStepChanged: (current, destination) async {
        if (_busy || _submission != null) return false;
        if (destination > current) {
          for (var i = 0; i < destination; i++) {
            final issue = _issue(i);
            if (issue != null) {
              setState(() => _error = issue);
              return false;
            }
          }
        }
        setState(() => _error = null);
        return true;
      },
      steps: [
        OrbitWizardStep(
          title: 'Dados gerais',
          hint: 'O cliente já está selecionado.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _section('Cliente', Icons.person_outline, [
                Text(widget.cliente.name, style: OrbitType.itemTitle),
              ]),
              const SizedBox(height: OrbitSpacing.md),
              TextField(
                controller: _title,
                maxLength: 220,
                decoration: const InputDecoration(
                  labelText: 'Título da proposta *',
                ),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              OutlinedButton.icon(
                onPressed: () async {
                  final date = await showDatePicker(
                    context: context,
                    initialDate: _validUntil,
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 730)),
                  );
                  if (date != null && mounted) {
                    setState(() {
                      _validUntil = date;
                      _reviewed = false;
                    });
                  }
                },
                icon: const Icon(Icons.event_outlined),
                label: Text(
                  'Validade: ${OrbitFormat.shortDate(CivilDate(_validUntil.year, _validUntil.month, _validUntil.day))}',
                ),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              DropdownButtonFormField<String>(
                initialValue: _addressId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Endereço de atendimento (opcional)',
                ),
                items: [
                  const DropdownMenuItem(
                    value: null,
                    child: Text('Não selecionar'),
                  ),
                  for (final a in _rows(options, 'addresses'))
                    DropdownMenuItem(
                      value: a['id'] as String,
                      child: Text(
                        '${a['label']} · ${a['street']}, ${a['number'] ?? 's/n'} · ${a['city']}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (id) => setState(() {
                  _addressId = id;
                  _reviewed = false;
                }),
              ),
              const SizedBox(height: OrbitSpacing.md),
              _section('Equipamentos (opcional)', Icons.ac_unit_outlined, [
                if (_rows(options, 'equipment').isEmpty)
                  const Text(
                    'Nenhum equipamento cadastrado para este cliente.',
                  ),
                for (final e in _rows(options, 'equipment'))
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(e['name'] as String),
                    subtitle: Text(
                      [
                        e['identifier'],
                        e['location'],
                      ].whereType<String>().join(' · '),
                    ),
                    value: _assetIds.contains(e['id']),
                    onChanged: (v) => setState(() {
                      v == true
                          ? _assetIds.add(e['id'] as String)
                          : _assetIds.remove(e['id']);
                    }),
                  ),
              ]),
              const SizedBox(height: OrbitSpacing.md),
              TextField(
                controller: _intro,
                minLines: 2,
                maxLines: 4,
                maxLength: 2000,
                decoration: const InputDecoration(
                  labelText: 'Apresentação (opcional)',
                  hintText: 'Deixe vazio para usar o texto padrão.',
                ),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              TextField(
                controller: _notes,
                minLines: 2,
                maxLines: 5,
                maxLength: 4000,
                decoration: const InputDecoration(
                  labelText: 'Observações (opcional)',
                ),
              ),
            ],
          ),
        ),
        OrbitWizardStep(
          title: 'Serviços e materiais',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton.icon(
                onPressed: _pickCatalog,
                icon: const Icon(Icons.search),
                label: const Text('Selecionar do catálogo'),
              ),
              TextButton.icon(
                onPressed: () => _addLine(),
                icon: const Icon(Icons.add),
                label: const Text('Adicionar item manual'),
              ),
              if (_lines.isEmpty)
                const Text('Adicione ao menos um serviço ou material.'),
              for (var i = 0; i < _lines.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: OrbitSpacing.ms),
                  child: OrbitCard(
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${_lines[i].description}\n${OrbitFormat.number(_lines[i].quantity)} × ${OrbitFormat.currency(_lines[i].unitPrice)}',
                          ),
                        ),
                        IconButton(
                          onPressed: () => setState(() {
                            _lines.removeAt(i);
                            _reviewed = false;
                          }),
                          icon: const Icon(Icons.delete_outline),
                          tooltip: 'Remover item',
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        OrbitWizardStep(
          title: 'Valores',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _section('Total da proposta', Icons.payments_outlined, [
                Text('Subtotal: ${OrbitFormat.currency(_subtotal)}'),
                const SizedBox(height: OrbitSpacing.ms),
                Text(
                  'Total: ${OrbitFormat.currency(_total)}',
                  style: OrbitType.itemTitle,
                ),
              ]),
              const SizedBox(height: OrbitSpacing.md),
              TextField(
                controller: _discount,
                onChanged: (_) => setState(() {}),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Desconto em R\$ (opcional)',
                ),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              TextField(
                controller: _discountReason,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Motivo do desconto (opcional)',
                ),
              ),
            ],
          ),
        ),
        OrbitWizardStep(
          title: 'Responsável técnico',
          hint:
              'A assinatura cadastrada da pessoa escolhida será incluída no PDF.',
          child: RadioGroup<String>(
            groupValue: _responsibleId,
            onChanged: (id) => setState(() {
              _responsibleId = id;
              _reviewed = false;
            }),
            child: Column(
              children: [
                for (final m in members)
                  RadioListTile<String>(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: OrbitSpacing.sm,
                    ),
                    value: m['id'] as String,
                    title: Text(m['name'] as String),
                    subtitle: Text(
                      m['hasSignature'] == true
                          ? 'Assinatura cadastrada'
                          : 'Sem assinatura cadastrada: o PDF terá a linha para assinar.',
                    ),
                  ),
                if (members.isEmpty)
                  const Text(
                    'Nenhum responsável disponível. Peça ao responsável pela empresa para revisar a equipe.',
                  ),
              ],
            ),
          ),
        ),
        OrbitWizardStep(
          title: 'Revisão',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _summary(),
              const SizedBox(height: OrbitSpacing.md),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _reviewed,
                onChanged: _busy
                    ? null
                    : (v) => setState(() => _reviewed = v ?? false),
                title: const Text(
                  'Revisei os dados e valores deste orçamento.',
                ),
              ),
              const Text(
                'Após gerar, você poderá coletar a assinatura e aprovação do cliente agora ou compartilhar o PDF.',
              ),
            ],
          ),
          forward: OrbitWizardForward(
            label: _submission != null
                ? 'Tentar gerar novamente'
                : 'Gerar orçamento',
            onPressed: _create,
            pending: _busy,
            enabled: _reviewed,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final options = ref.watch(mobileQuoteOptionsProvider(widget.cliente.id));
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        backgroundColor: context.orbit.background,
        appBar: AppBar(title: const Text('Novo orçamento')),
        body: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.lg,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_busy) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(OrbitSpacing.gutter),
                    child: Text(
                      _error!,
                      style: TextStyle(color: context.orbit.danger),
                    ),
                  ),
                if (_quote != null)
                  Padding(
                    padding: const EdgeInsets.all(OrbitSpacing.gutter),
                    child: _completed(),
                  )
                else
                  options.when(
                    data: _wizardContent,
                    loading: () => const Padding(
                      padding: EdgeInsets.all(48),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                    error: (error, _) => Padding(
                      padding: const EdgeInsets.all(OrbitSpacing.gutter),
                      child: Column(
                        children: [
                          Text(OrbitException.publicCopyForAny(error)),
                          TextButton(
                            onPressed: () => ref.invalidate(
                              mobileQuoteOptionsProvider(widget.cliente.id),
                            ),
                            child: const Text('Tentar novamente'),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogPicker extends ConsumerStatefulWidget {
  const _CatalogPicker();
  @override
  ConsumerState<_CatalogPicker> createState() => _CatalogPickerState();
}

class _CatalogPickerState extends ConsumerState<_CatalogPicker> {
  String _search = '';
  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(mobileQuoteCatalogProvider(_search));
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .75,
        child: Padding(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          child: Column(
            children: [
              Text('Serviços e materiais', style: OrbitType.sectionTitle),
              const SizedBox(height: OrbitSpacing.md),
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Pesquisar por nome ou SKU',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (v) => setState(() => _search = v),
              ),
              const SizedBox(height: OrbitSpacing.md),
              Expanded(
                child: catalog.when(
                  data: (items) => items.isEmpty
                      ? const Center(
                          child: Text(
                            'Nenhum item encontrado. Você pode adicionar um item manual.',
                          ),
                        )
                      : ListView.builder(
                          itemCount: items.length,
                          itemBuilder: (_, i) => ListTile(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: OrbitSpacing.sm,
                            ),
                            title: Text(items[i]['name'] as String),
                            subtitle: Text(
                              '${items[i]['sku'] ?? ''} · ${OrbitFormat.currency(double.tryParse('${items[i]['salePrice']}') ?? 0)}',
                            ),
                            trailing: const Icon(Icons.add_circle_outline),
                            onTap: () => Navigator.of(context).pop(items[i]),
                          ),
                        ),
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (e, _) => Column(
                    children: [
                      Text(OrbitException.publicCopyForAny(e)),
                      TextButton(
                        onPressed: () =>
                            ref.invalidate(mobileQuoteCatalogProvider(_search)),
                        child: const Text('Tentar novamente'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Uma linha nova: descrição, quantidade e preço unitário.
class _FolhaDeLinha extends StatefulWidget {
  const _FolhaDeLinha({this.catalog});

  final Map<String, dynamic>? catalog;

  @override
  State<_FolhaDeLinha> createState() => _FolhaDeLinhaState();
}

class _FolhaDeLinhaState extends State<_FolhaDeLinha> {
  final _descricao = TextEditingController();
  final _quantidade = TextEditingController(text: '1');
  final _preco = TextEditingController();

  @override
  void dispose() {
    _descricao.dispose();
    _quantidade.dispose();
    _preco.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    final item = widget.catalog;
    if (item != null) {
      _descricao.text = item['name'] as String;
      _preco.text = (double.tryParse('${item['salePrice']}') ?? 0)
          .toStringAsFixed(2)
          .replaceAll('.', ',');
    }
  }

  double? get _qtd => double.tryParse(_quantidade.text.replaceAll(',', '.'));
  double? get _unit => double.tryParse(_preco.text.replaceAll(',', '.'));

  bool get _valido =>
      _descricao.text.trim().length >= 2 &&
      (_qtd?.isFinite ?? false) &&
      (_qtd ?? 0) > 0 &&
      (_qtd ?? 0) <= 9999999 &&
      ((_qtd! * 1000).round() / 1000 == _qtd) &&
      (_unit?.isFinite ?? false) &&
      (_unit ?? -1) >= 0 &&
      (_unit ?? 0) <= 999999999.99 &&
      ((_unit! * 100).round() / 100 == _unit);

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          0,
          OrbitSpacing.gutter,
          OrbitSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Item do orçamento',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: OrbitSpacing.lg),
            TextField(
              controller: _descricao,
              maxLength: 255,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Descrição'),
            ),
            const SizedBox(height: OrbitSpacing.ms),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _quantidade,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(labelText: 'Quantidade'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  child: TextField(
                    controller: _preco,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Preço unitário',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: OrbitSpacing.lg),
            FilledButton(
              onPressed: _valido
                  ? () => Navigator.of(context).pop(
                      QuoteLine(
                        description: _descricao.text,
                        quantity: _qtd!,
                        unitPrice: _unit!,
                        catalogItemId: widget.catalog?['id'] as String?,
                        unit: widget.catalog?['unit'] as String?,
                      ),
                    )
                  : null,
              child: const Text('Adicionar item'),
            ),
          ],
        ),
      ),
    );
  }
}
