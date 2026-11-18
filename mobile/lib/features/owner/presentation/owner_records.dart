import 'package:flutter/material.dart';

import '../../../core/theme/orbit_theme.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';

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

  @override
  State<OwnerRecords> createState() => _OwnerRecordsState();
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

  Widget? _subtitle(OwnerRow row) {
    final caption = present(
      widget.subtitle?.call(row) ?? ownerStatus(row['status']),
    );
    return caption == null ? null : Text(caption);
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.title), actions: widget.actions),
    body: SafeArea(
      child: Column(
        children: [
          if (widget.search)
            Padding(
              padding: ownerPadding,
              child: TextField(
                controller: _query,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _refresh(),
                decoration: InputDecoration(
                  labelText: widget.searchLabel,
                  suffixIcon: IconButton(
                    tooltip: 'Buscar',
                    icon: const Icon(Icons.search),
                    onPressed: _refresh,
                  ),
                ),
              ),
            ),
          Expanded(
            child: FutureBuilder(
              future: _first,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Padding(
                    padding: ownerPadding,
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            ownerError(snapshot.error!),
                            textAlign: TextAlign.center,
                          ),
                          TextButton(
                            onPressed: _refresh,
                            child: const Text('Tentar novamente'),
                          ),
                        ],
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
                        const Padding(
                          padding: EdgeInsets.symmetric(
                            vertical: OrbitSpacing.xl,
                          ),
                          child: Center(
                            child: Text('Nenhum registro encontrado.'),
                          ),
                        ),
                      for (final row in items)
                        Card(
                          margin: const EdgeInsets.only(
                            bottom: OrbitSpacing.sm,
                          ),
                          child: ListTile(
                            title: Text(
                              widget.caption?.call(row) ?? ownerText(row),
                            ),
                            subtitle: _subtitle(row),
                            trailing: widget.open == null
                                ? null
                                : const Icon(Icons.chevron_right),
                            onTap: widget.open == null
                                ? null
                                : () => _run(() => widget.open!(context, row)),
                          ),
                        ),
                      if (current.hasMore)
                        OutlinedButton(
                          onPressed: _loadingMore ? null : () => _next(current),
                          child: Text(
                            _loadingMore ? 'Carregando…' : 'Carregar mais',
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          if (widget.create != null)
            Padding(
              padding: ownerPadding,
              child: SizedBox(
                width: double.infinity,
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

Future<void> ownerOpenRecords(BuildContext context, OwnerRecords screen) =>
    Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => screen));

OwnerRow ownerPageQuery(String search, int page, {String? unitId}) => {
  if (search.isNotEmpty) 'search': search,
  if (unitId != null) 'businessUnitId': unitId,
  'page': page,
  'limit': 25,
};
