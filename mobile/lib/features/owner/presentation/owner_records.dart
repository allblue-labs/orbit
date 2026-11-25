import 'package:flutter/material.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_style.dart';

/// Uma lista da Área do proprietário: busca, cartões, "carregar mais" e o
/// botão de criar fixo embaixo.
///
/// Cada cartão mostra o ícone do que o item é, o nome, os detalhes numa
/// linha, o estado num selo e — quando há dinheiro — o valor à direita. O
/// estado sai do texto de detalhes para o selo: escrito duas vezes, ele
/// competia com o resto.
class OwnerRecords extends StatefulWidget {
  const OwnerRecords({
    super.key,
    required this.title,
    required this.load,
    this.open,
    this.create,
    this.createLabel = 'Novo',
    this.caption,
    this.subtitle,
    this.search = false,
    this.searchLabel = 'Buscar',
    this.actions = const [],
    this.icon = Icons.article_outlined,
    this.iconOf,
    this.toneOf,
    this.badge,
    this.amount,
    this.emptyMessage,
  });

  final String title;
  final Future<OwnerPage> Function(String search, int page, String? cursor)
  load;
  final Future<bool> Function(BuildContext, OwnerRow)? open;
  final Future<bool> Function(BuildContext)? create;
  final String createLabel;
  final String Function(OwnerRow)? caption;
  final String Function(OwnerRow)? subtitle;
  final bool search;
  final String searchLabel;
  final List<Widget> actions;

  /// O ícone dos itens; [iconOf] escolhe por item.
  final IconData icon;
  final IconData Function(OwnerRow)? iconOf;
  final OrbitTone Function(OwnerRow)? toneOf;

  /// O selo do item. Sem ele, o `status` do servidor.
  final OwnerBadgeData? Function(OwnerRow)? badge;

  /// O valor em destaque à direita (dinheiro).
  final String? Function(OwnerRow)? amount;

  /// O que dizer quando a lista está vazia.
  final String? emptyMessage;

  @override
  State<OwnerRecords> createState() => _OwnerRecordsState();
}

/// O selo do `status` do servidor, quando há rótulo para ele.
OwnerBadgeData? ownerBadge(OwnerRow row, [String key = 'status']) {
  final label = ownerStatus(row[key]);
  return label.isEmpty ? null : (label: label, tone: ownerStatusTone(row[key]));
}

class _OwnerRecordsState extends State<OwnerRecords> {
  final _query = TextEditingController();
  late Future<OwnerPage> _first = widget.load('', 1, null);
  final _extra = <OwnerRow>[];
  OwnerPage? _last;
  var _page = 1;
  var _generation = 0;
  var _loadingMore = false;
  var _acting = false;
  String _search = '';

  Future<void> _refresh() async {
    setState(() {
      _generation++;
      _extra.clear();
      _last = null;
      _page = 1;
      _loadingMore = false;
      _search = _query.text.trim();
      _first = widget.load(_search, 1, null);
    });
    try {
      await _first;
    } catch (_) {
      // FutureBuilder shows the request error.
    }
  }

  Future<void> _next(OwnerPage current) async {
    final generation = _generation;
    setState(() => _loadingMore = true);
    try {
      final result = await widget.load(_search, _page + 1, current.nextCursor);
      if (!mounted || generation != _generation) return;
      setState(() {
        _page++;
        _extra.addAll(result.rows);
        _last = result;
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(ownerError(error))));
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loadingMore = false);
      }
    }
  }

  Future<void> _run(Future<bool> Function() action) async {
    if (_acting) return;
    setState(() => _acting = true);
    try {
      if (await action() && mounted) await _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(ownerError(error))));
      }
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Widget _item(OwnerRow row) {
    final badge = (widget.badge ?? ownerBadge).call(row);
    final amount = present(widget.amount?.call(row));
    /* O estado e o valor já têm lugar próprio: saem da linha de detalhes. */
    final meta = (widget.subtitle?.call(row) ?? '')
        .split(' · ')
        .map((part) => part.trim())
        .where(
          (part) => part.isNotEmpty && part != badge?.label && part != amount,
        )
        .join(' · ');
    return OwnerItemCard(
      icon: widget.iconOf?.call(row) ?? widget.icon,
      tone:
          widget.toneOf?.call(row) ??
          (badge?.tone == OrbitTone.danger
              ? OrbitTone.neutral
              : OrbitTone.info),
      title: widget.caption?.call(row) ?? ownerText(row),
      meta: meta,
      badge: badge,
      amount: amount,
      onTap: widget.open == null
          ? null
          : () => _run(() => widget.open!(context, row)),
    );
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Scaffold(
      backgroundColor: palette.background,
      appBar: AppBar(title: Text(widget.title), actions: widget.actions),
      body: SafeArea(
        child: Column(
          children: [
            if (widget.search)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  OrbitSpacing.gutter,
                  OrbitSpacing.sm,
                  OrbitSpacing.gutter,
                  OrbitSpacing.xs,
                ),
                child: ValueListenableBuilder(
                  valueListenable: _query,
                  builder: (context, value, _) => TextField(
                    controller: _query,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _refresh(),
                    decoration: InputDecoration(
                      hintText: widget.searchLabel,
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: value.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Limpar busca',
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () {
                                _query.clear();
                                _refresh();
                              },
                            ),
                    ),
                  ),
                ),
              ),
            Expanded(
              child: FutureBuilder(
                future: _first,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Padding(
                      padding: ownerPadding,
                      child: SectionLoading(lines: 5),
                    );
                  }
                  if (snapshot.hasError) {
                    return Center(
                      child: SingleChildScrollView(
                        child: OrbitEmptyState(
                          icon: Icons.cloud_off_outlined,
                          title: ownerError(snapshot.error!),
                          action: OutlinedButton.icon(
                            onPressed: _refresh,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Tentar novamente'),
                          ),
                        ),
                      ),
                    );
                  }
                  final first = snapshot.data ?? const OwnerPage([]);
                  final current = _last ?? first;
                  final items = [...first.rows, ..._extra];
                  return RefreshIndicator(
                    onRefresh: _refresh,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: ownerPadding,
                      children: [
                        if (items.isEmpty)
                          OrbitEmptyState(
                            icon: _search.isEmpty
                                ? widget.icon
                                : Icons.search_off_rounded,
                            title: _search.isEmpty
                                ? 'Nada por aqui ainda'
                                : 'Nenhum resultado',
                            description: _search.isNotEmpty
                                ? 'Nada encontrado para "$_search".'
                                : widget.emptyMessage ??
                                      (widget.create == null
                                          ? 'Nenhum registro encontrado.'
                                          : 'Toque em "${widget.createLabel}" para começar.'),
                          ),
                        for (final (indice, row) in items.indexed) ...[
                          if (indice > 0)
                            const SizedBox(height: OrbitSpacing.sm),
                          _item(row),
                        ],
                        if (current.hasMore) ...[
                          const SizedBox(height: OrbitSpacing.md),
                          OutlinedButton(
                            onPressed: _loadingMore
                                ? null
                                : () => _next(current),
                            child: Text(
                              _loadingMore ? 'Carregando…' : 'Carregar mais',
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
            if (widget.create != null)
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.surface,
                  border: Border(top: BorderSide(color: palette.border)),
                ),
                child: Padding(
                  padding: ownerPadding,
                  child: FilledButton.icon(
                    onPressed: _acting
                        ? null
                        : () => _run(() => widget.create!(context)),
                    icon: const Icon(Icons.add),
                    label: Text(widget.createLabel),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

Future<void> ownerOpenRecords(BuildContext context, OwnerRecords screen) =>
    Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => screen));

OwnerRow ownerPageQuery(String search, int page, {String? unitId}) => {
  if (search.isNotEmpty) 'search': search,
  if (unitId != null) 'businessUnitId': unitId,
  'page': page,
  'limit': 25,
};
