/// Registrar consumo de material.
///
/// A busca é **do servidor** (`GET /catalog/products?search=`): carregar o
/// catálogo inteiro para filtrar aqui pareceria mais simples até o primeiro
/// almoxarifado com milhares de itens.
///
/// O estoque é do Inventory. O app envia a intenção e mostra o que voltou —
/// recusa por saldo insuficiente é decisão do servidor, apresentada como veio.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/errors/orbit_exception.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../sync/application/sync_controller.dart';
import '../../application/execution_controller.dart';

/// Um item do catálogo, no mínimo que a escolha exige.
class _CatalogItem {
  const _CatalogItem({required this.id, required this.name, this.unit});

  final String id;
  final String name;
  final String? unit;
}

Future<void> showMaterialSheet(
  BuildContext context,
  ExecutionController controller,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (context) => _MaterialSheet(controller: controller),
);

class _MaterialSheet extends ConsumerStatefulWidget {
  const _MaterialSheet({required this.controller});

  final ExecutionController controller;

  @override
  ConsumerState<_MaterialSheet> createState() => _MaterialSheetState();
}

class _MaterialSheetState extends ConsumerState<_MaterialSheet> {
  final _search = TextEditingController();
  final _quantity = TextEditingController(text: '1');

  List<_CatalogItem> _results = const [];
  _CatalogItem? _selected;
  bool _searching = false;
  bool _sending = false;
  String? _failure;

  @override
  void dispose() {
    _search.dispose();
    _quantity.dispose();
    super.dispose();
  }

  Future<void> _find() async {
    final term = _search.text.trim();
    if (term.isEmpty) return;
    setState(() {
      _searching = true;
      _failure = null;
    });
    try {
      final data = await ref
          .read(apiClientProvider)
          .get<Map<String, dynamic>>(
            '/catalog/products',
            query: {'search': term, 'limit': 20},
          );
      final items = (data['data'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(
            (json) => _CatalogItem(
              id: json['id'] as String? ?? '',
              name: json['name'] as String? ?? '',
              unit: json['unitOfMeasure'] as String? ?? json['unit'] as String?,
            ),
          )
          .toList(growable: false);
      if (mounted) setState(() => _results = items);
    } on OrbitException catch (error) {
      if (mounted) setState(() => _failure = error.publicMessage);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _submit() async {
    final item = _selected;
    final quantity = num.tryParse(_quantity.text.replaceAll(',', '.'));
    if (item == null || quantity == null || quantity <= 0 || _sending) return;

    setState(() {
      _sending = true;
      _failure = null;
    });
    try {
      final outcome = await widget.controller.registerMaterial(
        catalogItemId: item.id,
        quantity: quantity,
      );

      /// A recusa do servidor — saldo insuficiente, por exemplo — é mostrada
      /// como veio. O app não ajusta a quantidade sozinho.
      if (outcome is CommandBlocked) {
        if (mounted) setState(() => _failure = outcome.message);
        return;
      }
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: OrbitSpacing.md,
        right: OrbitSpacing.md,
        top: OrbitSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Material',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _find(),
            decoration: InputDecoration(
              hintText: 'Buscar no catálogo',
              suffixIcon: IconButton(
                icon: const Icon(Icons.search),
                onPressed: _searching ? null : _find,
              ),
            ),
          ),
          if (_searching)
            const Padding(
              padding: EdgeInsets.all(OrbitSpacing.md),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          if (_results.isNotEmpty)
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: ListView(
                shrinkWrap: true,
                children: [
                  /// `ListTile` com seleção em vez de `Radio`: alvo maior,
                  /// que é o que serve para um toque com luva.
                  for (final item in _results)
                    ListTile(
                      selected: _selected?.id == item.id,
                      onTap: () => setState(() => _selected = item),
                      leading: Icon(
                        _selected?.id == item.id
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                      ),
                      title: Text(item.name),
                      subtitle: item.unit == null ? null : Text(item.unit!),
                    ),
                ],
              ),
            ),
          const SizedBox(height: OrbitSpacing.sm),
          TextField(
            controller: _quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Quantidade'),
          ),
          if (_failure case final String message) ...[
            const SizedBox(height: OrbitSpacing.sm),
            Text(
              message,
              style: const TextStyle(fontSize: 13, color: OrbitColors.danger),
            ),
          ],
          const SizedBox(height: OrbitSpacing.sm),
          FilledButton(
            onPressed: _selected == null || _sending ? null : _submit,
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            child: Text(_sending ? 'Registrando…' : 'Registrar material'),
          ),
        ],
      ),
    );
  }
}
