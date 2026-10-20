/// Listagem de operações.
///
/// Paginação, busca e filtros são do servidor (`OperationQueryDto`). Nada é
/// filtrado localmente: com paginação no backend, filtrar a página atual daria
/// um resultado errado.
///
/// **Ordenação**: o DTO não aceita parâmetro de ordenação — o backend ordena
/// por agendamento e criação. O app não oferece o controle em vez de fingir
/// uma ordem que não existe.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'dart:async';

import '../../../core/contracts/operation_contracts.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_screen_header.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/operations_providers.dart';
import 'widgets/operation_tile.dart';

class OperationsScreen extends ConsumerStatefulWidget {
  const OperationsScreen({super.key});

  @override
  ConsumerState<OperationsScreen> createState() => _OperationsScreenState();
}

class _OperationsScreenState extends ConsumerState<OperationsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  /// Espera a pessoa parar de digitar.
  ///
  /// Antes a busca só disparava no `onSubmitted`: quem digitava e olhava a
  /// lista não via nada acontecer, e concluía que a busca não funcionava.
  void _aoDigitar(String valor) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      final limpo = valor.trim();
      ref
          .read(operationsFilterProvider.notifier)
          .setSearch(limpo.isEmpty ? null : limpo);
      setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final query = ref.watch(operationsFilterProvider);
    final filters = ref.read(operationsFilterProvider.notifier);
    final list = ref.watch(operationsListProvider);

    final total = list.valueOrNull?.value.total;

    return Scaffold(
      backgroundColor: context.orbit.background,
      body: Column(
        children: [
          /// A mesma barra de Atendimentos, Clientes e Documentos: superfície
          /// elevada, separada do conteúdo por sombra. Era um `AppBar` com a
          /// busca solta embaixo, e a faixa de chips de 52 pixels encostava no
          /// primeiro item da lista.
          Container(
            decoration: BoxDecoration(
              color: context.orbit.surface,
              boxShadow: OrbitShadow.card,
            ),
            child: SafeArea(
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      OrbitSpacing.gutter,
                      OrbitSpacing.sm,
                      OrbitSpacing.gutter,
                      OrbitSpacing.ms,
                    ),
                    child: OrbitScreenHeading(
                      title: 'Operações',
                      count: total == null
                          ? null
                          : total == 1
                          ? '1 operação'
                          : '$total operações',
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      OrbitSpacing.gutter,
                      0,
                      OrbitSpacing.gutter,
                      OrbitSpacing.ms,
                    ),
                    child: TextField(
                      key: const Key('operations.search'),
                      controller: _searchController,
                      textInputAction: TextInputAction.search,
                      onChanged: _aoDigitar,
                      onSubmitted: filters.setSearch,
                      decoration: InputDecoration(
                        hintText: 'Código, título ou descrição',
                        prefixIcon: const Icon(Icons.search_rounded, size: 20),
                        suffixIcon: _searchController.text.isEmpty
                            ? null
                            : IconButton(
                                icon: const Icon(Icons.close_rounded, size: 18),
                                tooltip: 'Limpar busca',
                                onPressed: () {
                                  _searchController.clear();
                                  _aoDigitar('');
                                },
                              ),
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: OrbitSpacing.md,
                          vertical: OrbitSpacing.ms,
                        ),
                      ),
                    ),
                  ),
                  OrbitChipStrip(
                    trailing: query.hasFilters
                        ? _BotaoLimpar(
                            onTap: () {
                              _searchController.clear();
                              filters.reset();
                            },
                          )
                        : null,
                    children: [
                      _Chip(
                        rotulo: 'Todas',
                        ativo: query.status == null,
                        onTap: () => filters.setStatus(null),
                      ),
                      for (final status in OperationStatus.all)
                        _Chip(
                          rotulo: OperationStatus.label(status),
                          ativo: query.status == status,
                          onTap: () => filters.setStatus(status),
                        ),
                    ],
                  ),
                  const SizedBox(height: OrbitSpacing.ms),
                ],
              ),
            ),
          ),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(operationsListProvider),
              child: list.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(OrbitSpacing.gutter),
                  child: SectionLoading(lines: 6),
                ),
                error: (error, _) => ListView(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  children: [
                    SectionError(
                      error: error,
                      onRetry: () => ref.invalidate(operationsListProvider),
                    ),
                  ],
                ),
                data: (result) {
                  final page = result.value;
                  if (page.isEmpty) {
                    return ListView(
                      padding: const EdgeInsets.all(OrbitSpacing.gutter),
                      children: const [
                        SectionEmpty(
                          message:
                              'Nenhuma operação encontrada com estes filtros.',
                        ),
                      ],
                    );
                  }
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(
                      OrbitSpacing.gutter,
                      OrbitSpacing.sm,
                      OrbitSpacing.gutter,
                      OrbitSpacing.xl,
                    ),
                    children: [
                      if (result.cachedAt != null)
                        StaleDataBanner(cachedAt: result.cachedAt!),

                      /// Só a página, porque o total já está no cabeçalho.
                      if (page.totalPages > 1)
                        Padding(
                          padding: const EdgeInsets.only(
                            left: OrbitSpacing.xs,
                            bottom: OrbitSpacing.ms,
                          ),
                          child: Text(
                            'Página ${page.page} de ${page.totalPages}',
                            style: OrbitType.caption.copyWith(
                              color: context.orbit.inkSubtle,
                            ),
                          ),
                        ),

                      /// As linhas moram dentro de um cartão. Soltas sobre o
                      /// fundo da página elas não têm contenção nenhuma, e a
                      /// tela lê como uma lista de ajustes do sistema.
                      OrbitCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            for (final (indice, operation)
                                in page.data.indexed) ...[
                              if (indice > 0) const OrbitRowDivider(),
                              OperationTile(
                                operation: operation,
                                onTap: () => context.push(
                                  OrbitRoutes.operationDetail(operation.id),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (page.totalPages > 1)
                        _Pagination(
                          page: page,
                          onPrevious: filters.previousPage,
                          onNext: filters.nextPage,
                        ),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// O mesmo chip das outras listas.
class _Chip extends StatelessWidget {
  const _Chip({required this.rotulo, required this.ativo, required this.onTap});

  final String rotulo;
  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.only(right: OrbitSpacing.sm),
      child: Semantics(
        selected: ativo,
        button: true,
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.md,
              vertical: OrbitSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: ativo ? palette.accent : palette.surface,
              borderRadius: OrbitRadius.pill,
              border: Border.all(
                color: ativo ? palette.accent : palette.border,
              ),
            ),
            child: Text(
              rotulo,
              style: OrbitType.label.copyWith(
                fontSize: 13,
                color: ativo ? Colors.white : palette.inkMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Só aparece quando há o que limpar.
class _BotaoLimpar extends StatelessWidget {
  const _BotaoLimpar({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      button: true,
      label: 'Limpar filtros',
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.ms),
          decoration: BoxDecoration(
            color: palette.accentSoft,
            borderRadius: OrbitRadius.pill,
            border: Border.all(color: palette.accent),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.filter_alt_off_outlined,
                size: 16,
                color: palette.accentStrong,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Pagination extends StatelessWidget {
  const _Pagination({
    required this.page,
    required this.onPrevious,
    required this.onNext,
  });

  final Paginated<Operation> page;
  final VoidCallback onPrevious;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.md),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          OutlinedButton(
            onPressed: page.hasPreviousPage ? onPrevious : null,
            child: const Text('Anterior'),
          ),
          const SizedBox(width: OrbitSpacing.sm),
          OutlinedButton(
            onPressed: page.hasNextPage ? onNext : null,
            child: const Text('Próxima'),
          ),
        ],
      ),
    );
  }
}
