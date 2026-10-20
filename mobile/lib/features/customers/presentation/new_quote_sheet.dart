/// Abrir um orçamento para um cliente.
///
/// ## Por que as linhas são obrigatórias aqui
///
/// O servidor aceita um orçamento sem itens — ele nasce vazio e as linhas
/// entram depois. Mas um orçamento sem linha não é um orçamento: é um título
/// e um cliente. Quem abre um do celular está na frente do problema e sabe o
/// que vai cobrar; exigir ao menos uma linha impede o rascunho órfão que
/// alguém encontra semanas depois sem saber o que era.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../application/customer_write_providers.dart';
import '../data/customer_write_repository.dart';

Future<bool> showNewQuoteSheet(
  BuildContext context,
  MobileFieldCustomerContract cliente,
) async {
  final criado = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: _Folha(cliente: cliente),
    ),
  );
  return criado ?? false;
}

class _Folha extends ConsumerStatefulWidget {
  const _Folha({required this.cliente});

  final MobileFieldCustomerContract cliente;

  @override
  ConsumerState<_Folha> createState() => _FolhaState();
}

class _FolhaState extends ConsumerState<_Folha> {
  final _titulo = TextEditingController();
  final _linhas = <QuoteLine>[];
  bool _salvando = false;
  Object? _erro;

  @override
  void dispose() {
    _titulo.dispose();
    super.dispose();
  }

  bool get _valido => _titulo.text.trim().length >= 2 && _linhas.isNotEmpty;

  double get _total =>
      _linhas.fold<double>(0, (soma, linha) => soma + linha.total);

  Future<void> _adicionarLinha() async {
    final linha = await showModalBottomSheet<QuoteLine>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.orbit.background,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: const _FolhaDeLinha(),
      ),
    );
    if (linha != null) setState(() => _linhas.add(linha));
  }

  Future<void> _salvar() async {
    if (!_valido || _salvando) return;
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      final sessao = ref.read(sessionProvider);
      final resultado = await ref
          .read(customerWriteRepositoryProvider)
          .createQuote(
            customerId: widget.cliente.id,
            title: _titulo.text,
            businessUnitId: sessao?.businessUnitId,
            items: _linhas,
          );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Orçamento aberto com '
              '${resultado.itemsAdded} '
              '${resultado.itemsAdded == 1 ? "item" : "itens"}.',
            ),
          ),
        );
      }
    } on OrbitException catch (error) {
      if (mounted) {
        setState(() {
          _erro = error;
          _salvando = false;
        });
      }
    }
  }

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
              'Novo orçamento',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: OrbitSpacing.xs),
            Text(
              widget.cliente.name,
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),
            const SizedBox(height: OrbitSpacing.lg),

            TextField(
              controller: _titulo,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Título',
                hintText: 'Troca de compressor — Chiller 40TR',
              ),
            ),
            const SizedBox(height: OrbitSpacing.lg),

            Row(
              children: [
                Expanded(
                  child: Text(
                    'Itens',
                    style: OrbitType.label.copyWith(color: palette.inkSubtle),
                  ),
                ),
                TextButton.icon(
                  onPressed: _adicionarLinha,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Adicionar'),
                ),
              ],
            ),
            const SizedBox(height: OrbitSpacing.xs),

            if (_linhas.isEmpty)
              Container(
                padding: const EdgeInsets.all(OrbitSpacing.md),
                decoration: BoxDecoration(
                  color: palette.surfaceMuted,
                  borderRadius: OrbitRadius.card,
                ),
                child: Text(
                  'Um orçamento precisa de ao menos um item.',
                  textAlign: TextAlign.center,
                  style: OrbitType.caption.copyWith(color: palette.inkSubtle),
                ),
              )
            else
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: OrbitCard(
                  padding: EdgeInsets.zero,
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _linhas.length,
                    separatorBuilder: (_, _) => const OrbitRowDivider(),
                    itemBuilder: (context, indice) {
                      final linha = _linhas[indice];
                      return ListTile(
                        dense: true,
                        contentPadding: const EdgeInsets.only(
                          left: OrbitSpacing.ml,
                          right: OrbitSpacing.sm,
                        ),
                        title: Text(
                          linha.description,
                          style: OrbitType.body.copyWith(color: palette.ink),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          '${OrbitFormat.number(linha.quantity)} × '
                          '${OrbitFormat.currency(linha.unitPrice)}',
                          style: OrbitType.caption.copyWith(
                            color: palette.inkSubtle,
                          ),
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              OrbitFormat.currency(linha.total),
                              style: OrbitType.numeric.copyWith(
                                color: palette.ink,
                              ),
                            ),
                            IconButton(
                              onPressed: () =>
                                  setState(() => _linhas.removeAt(indice)),
                              icon: const Icon(Icons.close_rounded, size: 17),
                              tooltip: 'Remover item',
                              visualDensity: VisualDensity.compact,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              ),

            if (_linhas.isNotEmpty) ...[
              const SizedBox(height: OrbitSpacing.ms),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    'Total ',
                    style: OrbitType.caption.copyWith(color: palette.inkSubtle),
                  ),
                  Text(
                    OrbitFormat.currency(_total),
                    style: OrbitType.itemTitle.copyWith(color: palette.ink),
                  ),
                ],
              ),
            ],

            if (_erro != null) ...[
              const SizedBox(height: OrbitSpacing.md),
              Text(
                _erro is OrbitException
                    ? (_erro! as OrbitException).publicMessage
                    : 'Não foi possível abrir o orçamento.',
                style: OrbitType.body.copyWith(color: palette.danger),
              ),
            ],

            const SizedBox(height: OrbitSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _salvando
                        ? null
                        : () => Navigator.of(context).pop(false),
                    child: const Text('Cancelar'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _valido && !_salvando ? _salvar : null,
                    child: Text(_salvando ? 'Abrindo…' : 'Abrir orçamento'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Uma linha nova: descrição, quantidade e preço unitário.
class _FolhaDeLinha extends StatefulWidget {
  const _FolhaDeLinha();

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

  double? get _qtd => double.tryParse(_quantidade.text.replaceAll(',', '.'));
  double? get _unit => double.tryParse(_preco.text.replaceAll(',', '.'));

  bool get _valido =>
      _descricao.text.trim().length >= 2 &&
      (_qtd ?? 0) > 0 &&
      (_unit ?? -1) >= 0;

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
