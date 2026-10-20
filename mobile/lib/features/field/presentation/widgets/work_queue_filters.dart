/// Os recortes da tela de Atendimentos.
///
/// ## Onde cada filtro mora, e por quê
///
/// O **recorte de prazo** fica sempre visível, em abas: é o que a pessoa troca
/// dezenas de vezes por dia, e esconder atrás de um botão custaria dois toques
/// a cada troca.
///
/// **Tipo, cliente e período** ficam numa folha. São escolhas que se faz uma
/// vez e se esquece; ocupando a tela permanentemente, roubariam do único
/// conteúdo que importa — a lista.
///
/// O botão de filtros carrega o número de recortes ativos. Sem ele, um filtro
/// esquecido vira "o aplicativo não está mostrando meus atendimentos".
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/mobile_field_contracts.dart';
import '../../../../core/design/orbit_primitives.dart';
import '../../../../core/design/orbit_screen_header.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/field_providers.dart';
import '../../data/field_repository.dart';

const _rotulosDeRecorte = <WorkQueueView, String>{
  WorkQueueView.all: 'Tudo',
  WorkQueueView.inProgress: 'Em andamento',
  WorkQueueView.overdue: 'Atrasados',
  WorkQueueView.today: 'Hoje',
  WorkQueueView.upcoming: 'Próximos',
};

/// A barra de topo: busca, recortes de prazo e o botão de filtros.
///
/// ## O que a primeira versão errou
///
/// Os chips ocupavam uma faixa de 52 pixels, o botão de filtros ficava
/// espremido e cortado na borda, e um filete encostava direto no primeiro
/// cabeçalho da lista. Três blocos colados, sem nenhuma folga entre eles —
/// não dava para ver onde o controle terminava e o conteúdo começava.
///
/// Agora há uma superfície de controle **elevada**, com a busca no topo, os
/// recortes abaixo e uma sombra que a separa do que rola por baixo. A
/// separação é por camada, não por filete: filete divide, sombra ordena.
class WorkQueueFilterBar extends ConsumerStatefulWidget {
  const WorkQueueFilterBar({
    super.key,
    required this.filter,
    required this.resultCount,
  });

  final WorkQueueFilter filter;

  /// Quantos itens a lista está mostrando. Fica na barra porque é a resposta
  /// à pergunta que o filtro acabou de fazer.
  final int resultCount;

  @override
  ConsumerState<WorkQueueFilterBar> createState() => _WorkQueueFilterBarState();
}

class _WorkQueueFilterBarState extends ConsumerState<WorkQueueFilterBar> {
  late final TextEditingController _busca = TextEditingController(
    text: widget.filter.search ?? '',
  );
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _busca.dispose();
    super.dispose();
  }

  /// Espera a pessoa parar de digitar.
  ///
  /// Sem isso, "Shopping Recife" dispara catorze requisições e as respostas
  /// chegam fora de ordem — a lista mostra o resultado de "Shoppin" depois do
  /// de "Shopping Recife".
  void _aoDigitar(String valor) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      final atual = ref.read(workQueueFilterProvider);
      final limpo = valor.trim();
      ref.read(workQueueFilterProvider.notifier).state = limpo.isEmpty
          ? atual.copyWith(clearSearch: true)
          : atual.copyWith(search: limpo);
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final filter = widget.filter;

    return Container(
      decoration: BoxDecoration(
        color: palette.surface,
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
                title: 'Atendimentos',
                count: widget.resultCount == 1
                    ? '1 resultado'
                    : '${widget.resultCount} resultados',
              ),
            ),

            /// A busca vem antes dos recortes: procurar um cliente pelo nome é
            /// mais direto que combinar filtros, e quem sabe o nome não
            /// deveria passar por eles.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                0,
                OrbitSpacing.gutter,
                OrbitSpacing.ms,
              ),
              child: TextField(
                controller: _busca,
                onChanged: _aoDigitar,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Cliente, serviço ou equipamento',
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  suffixIcon: _busca.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          tooltip: 'Limpar busca',
                          onPressed: () {
                            _busca.clear();
                            _aoDigitar('');
                            setState(() {});
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
              trailing: _BotaoDeFiltros(
                ativos: filter.activeCount,
                onTap: () => showWorkQueueFilterSheet(context, ref, filter),
              ),
              children: [
                for (final recorte in _rotulosDeRecorte.keys)
                  Padding(
                    padding: const EdgeInsets.only(right: OrbitSpacing.sm),
                    child: _Chip(
                      rotulo: _rotulosDeRecorte[recorte]!,
                      ativo: recorte == filter.view,
                      onTap: () =>
                          ref.read(workQueueFilterProvider.notifier).state =
                              filter.copyWith(view: recorte),
                    ),
                  ),
              ],
            ),

            /// Os recortes ativos ficam visíveis e removíveis um a um. Guardá-los
            /// só dentro da folha faz a pessoa procurar por que a lista encolheu.
            if (filter.activeCount > 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  OrbitSpacing.gutter,
                  OrbitSpacing.ms,
                  OrbitSpacing.gutter,
                  0,
                ),
                child: Wrap(
                  spacing: OrbitSpacing.sm,
                  runSpacing: OrbitSpacing.xs,
                  children: [
                    if (filter.kind case final tipo?)
                      _ChipRemovivel(
                        rotulo: workItemKindLabel(tipo),
                        onRemove: () =>
                            ref.read(workQueueFilterProvider.notifier).state =
                                filter.copyWith(clearKind: true),
                      ),
                    if (filter.customerId != null)
                      _ChipRemovivel(
                        rotulo: filter.customerName ?? 'Cliente',
                        onRemove: () =>
                            ref.read(workQueueFilterProvider.notifier).state =
                                filter.copyWith(clearCustomer: true),
                      ),
                    if (filter.from != null || filter.to != null)
                      _ChipRemovivel(
                        rotulo: _periodo(filter.from, filter.to),
                        onRemove: () =>
                            ref.read(workQueueFilterProvider.notifier).state =
                                filter.copyWith(clearDates: true),
                      ),
                    TextButton(
                      onPressed: () =>
                          ref
                              .read(workQueueFilterProvider.notifier)
                              .state = WorkQueueFilter(
                            view: filter.view,
                            search: filter.search,
                          ),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                          horizontal: OrbitSpacing.sm,
                        ),
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text('Limpar'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: OrbitSpacing.ms),
          ],
        ),
      ),
    );
  }
}

String _periodo(DateTime? de, DateTime? ate) {
  String curta(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  if (de != null && ate != null) return '${curta(de)} – ${curta(ate)}';
  if (de != null) return 'A partir de ${curta(de)}';
  return 'Até ${curta(ate!)}';
}

class _Chip extends StatelessWidget {
  const _Chip({required this.rotulo, required this.ativo, required this.onTap});

  final String rotulo;
  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      selected: ativo,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,

        /// Sem `alignment`: um `Container` alinhado **estica** até o limite
        /// quando a largura não está restrita, e dentro de um `Wrap` isso
        /// vira um chip por linha ocupando a tela toda. O padding e o texto
        /// já dão a medida.
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.md,
            vertical: OrbitSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: ativo ? palette.accent : palette.surface,
            borderRadius: OrbitRadius.pill,
            border: Border.all(color: ativo ? palette.accent : palette.border),
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
    );
  }
}

class _ChipRemovivel extends StatelessWidget {
  const _ChipRemovivel({required this.rotulo, required this.onRemove});

  final String rotulo;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Container(
      padding: const EdgeInsets.only(left: OrbitSpacing.ms, right: 4),
      decoration: BoxDecoration(
        color: palette.accentSoft,
        borderRadius: OrbitRadius.pill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            rotulo,
            style: OrbitType.label.copyWith(
              fontSize: 12.5,
              color: palette.accentStrong,
            ),
          ),
          IconButton(
            onPressed: onRemove,
            icon: const Icon(Icons.close_rounded, size: 15),
            color: palette.accentStrong,
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            padding: EdgeInsets.zero,
            tooltip: 'Remover filtro',
          ),
        ],
      ),
    );
  }
}

class _BotaoDeFiltros extends StatelessWidget {
  const _BotaoDeFiltros({required this.ativos, required this.onTap});

  final int ativos;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      button: true,
      label: ativos > 0 ? 'Filtros, $ativos ativos' : 'Filtros',
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.ms),
          decoration: BoxDecoration(
            color: ativos > 0 ? palette.accentSoft : palette.surface,
            borderRadius: OrbitRadius.pill,
            border: Border.all(
              color: ativos > 0 ? palette.accent : palette.border,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.tune_rounded,
                size: 17,
                color: ativos > 0 ? palette.accentStrong : palette.inkMuted,
              ),
              if (ativos > 0) ...[
                const SizedBox(width: 5),
                Text(
                  '$ativos',
                  style: OrbitType.numeric.copyWith(
                    fontSize: 13,
                    color: palette.accentStrong,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A folha: tipo, cliente e período.
///
/// Aplica no botão, não a cada toque. Filtrar a cada escolha faria três
/// requisições para quem quer combinar três recortes — e a lista piscaria
/// entre resultados que ninguém pediu.
Future<void> showWorkQueueFilterSheet(
  BuildContext context,
  WidgetRef ref,
  WorkQueueFilter atual,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => _FolhaDeFiltros(inicial: atual),
  );
}

class _FolhaDeFiltros extends ConsumerStatefulWidget {
  const _FolhaDeFiltros({required this.inicial});

  final WorkQueueFilter inicial;

  @override
  ConsumerState<_FolhaDeFiltros> createState() => _FolhaDeFiltrosState();
}

class _FolhaDeFiltrosState extends ConsumerState<_FolhaDeFiltros> {
  late WorkQueueFilter _rascunho = widget.inicial;

  Future<void> _escolherPeriodo() async {
    final hoje = DateTime.now();
    final intervalo = await showDateRangePicker(
      context: context,
      firstDate: DateTime(hoje.year - 2),
      lastDate: DateTime(hoje.year + 2),
      initialDateRange: _rascunho.from != null && _rascunho.to != null
          ? DateTimeRange(start: _rascunho.from!, end: _rascunho.to!)
          : null,
      helpText: 'Período dos atendimentos',
      saveText: 'Aplicar',
    );
    if (intervalo == null) return;
    setState(
      () => _rascunho = _rascunho.copyWith(
        from: intervalo.start,
        to: intervalo.end,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final clientes = ref.watch(queueCustomersProvider);

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              OrbitSpacing.gutter,
              0,
              OrbitSpacing.gutter,
              OrbitSpacing.ms,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Filtrar atendimentos',
                    style: OrbitType.sectionTitle.copyWith(color: palette.ink),
                  ),
                ),
                if (_rascunho.activeCount > 0)
                  TextButton(
                    onPressed: () => setState(
                      () => _rascunho = WorkQueueFilter(
                        view: _rascunho.view,
                        search: _rascunho.search,
                      ),
                    ),
                    child: const Text('Limpar tudo'),
                  ),
              ],
            ),
          ),

          /// O conteúdo rola; a ação não.
          ///
          /// Na primeira versão o botão "Aplicar" rolava junto com a lista de
          /// clientes. Com vinte clientes ele ficava abaixo da dobra, e a
          /// pessoa escolhia o filtro sem ter como confirmá-lo.
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                0,
                OrbitSpacing.gutter,
                OrbitSpacing.lg,
              ),
              children: [
                const _Rotulo('Tipo'),
                Wrap(
                  spacing: OrbitSpacing.sm,
                  runSpacing: OrbitSpacing.sm,
                  children: [
                    _Opcao(
                      rotulo: 'Todos',
                      ativo: _rascunho.kind == null,
                      onTap: () => setState(
                        () => _rascunho = _rascunho.copyWith(clearKind: true),
                      ),
                    ),
                    for (final tipo in MobileWorkItemKind.values)
                      _Opcao(
                        rotulo: workItemKindLabel(tipo),
                        ativo: _rascunho.kind == tipo,
                        onTap: () => setState(
                          () => _rascunho = _rascunho.copyWith(kind: tipo),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: OrbitSpacing.lg),

                const _Rotulo('Período'),
                OutlinedButton.icon(
                  onPressed: _escolherPeriodo,
                  icon: const Icon(Icons.date_range_outlined, size: 18),
                  label: Text(
                    _rascunho.from == null && _rascunho.to == null
                        ? 'Qualquer data'
                        : _periodo(_rascunho.from, _rascunho.to),
                  ),
                ),
                if (_rascunho.from != null || _rascunho.to != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => setState(
                        () => _rascunho = _rascunho.copyWith(clearDates: true),
                      ),
                      child: const Text('Qualquer data'),
                    ),
                  ),
                const SizedBox(height: OrbitSpacing.lg),

                const _Rotulo('Cliente'),
                clientes.when(
                  loading: () => const SectionLoading(lines: 3),
                  error: (error, _) => SectionError(
                    error: error,
                    onRetry: () => ref.invalidate(queueCustomersProvider),
                  ),
                  data: (lista) => lista.isEmpty
                      ? Text(
                          'Nenhum cliente com atendimento seu.',
                          style: OrbitType.body.copyWith(
                            color: palette.inkSubtle,
                          ),
                        )
                      : OrbitCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              _LinhaDeCliente(
                                nome: 'Todos os clientes',
                                contagem: null,
                                ativo: _rascunho.customerId == null,
                                onTap: () => setState(
                                  () => _rascunho = _rascunho.copyWith(
                                    clearCustomer: true,
                                  ),
                                ),
                              ),
                              for (final cliente in lista) ...[
                                const OrbitRowDivider(),
                                _LinhaDeCliente(
                                  nome: cliente.name,
                                  contagem: cliente.workCount,
                                  ativo: _rascunho.customerId == cliente.id,
                                  onTap: () => setState(
                                    () => _rascunho = _rascunho.copyWith(
                                      customerId: cliente.id,
                                      customerName: cliente.name,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                ),
              ],
            ),
          ),

          /// A barra de ação, colada no rodapé e separada por sombra.
          Container(
            padding: const EdgeInsets.fromLTRB(
              OrbitSpacing.gutter,
              OrbitSpacing.ms,
              OrbitSpacing.gutter,
              OrbitSpacing.ms,
            ),
            decoration: BoxDecoration(
              color: palette.surface,
              boxShadow: OrbitShadow.raised,
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancelar'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () {
                      ref.read(workQueueFilterProvider.notifier).state =
                          _rascunho;
                      Navigator.of(context).pop();
                    },
                    child: Text(
                      _rascunho.activeCount == 0
                          ? 'Ver atendimentos'
                          : 'Aplicar ${_rascunho.activeCount} '
                                '${_rascunho.activeCount == 1 ? "filtro" : "filtros"}',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Rotulo extends StatelessWidget {
  const _Rotulo(this.texto);

  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
    child: Text(
      texto.toUpperCase(),
      style: OrbitType.eyebrow.copyWith(color: context.orbit.inkSubtle),
    ),
  );
}

class _Opcao extends StatelessWidget {
  const _Opcao({
    required this.rotulo,
    required this.ativo,
    required this.onTap,
  });

  final String rotulo;
  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) =>
      _Chip(rotulo: rotulo, ativo: ativo, onTap: onTap);
}

class _LinhaDeCliente extends StatelessWidget {
  const _LinhaDeCliente({
    required this.nome,
    required this.contagem,
    required this.ativo,
    required this.onTap,
  });

  final String nome;
  final int? contagem;
  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.ml),
      onTap: onTap,
      title: Text(
        nome,
        style: OrbitType.body.copyWith(
          color: palette.ink,
          fontWeight: ativo ? FontWeight.w600 : FontWeight.w400,
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (contagem != null)
            Text(
              '$contagem',
              style: OrbitType.numeric.copyWith(
                fontSize: 13,
                color: palette.inkSubtle,
              ),
            ),
          if (ativo) ...[
            const SizedBox(width: OrbitSpacing.sm),
            Icon(Icons.check_rounded, size: 18, color: palette.accent),
          ],
        ],
      ),
    );
  }
}
