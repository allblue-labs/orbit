/// Documentos — o que já foi emitido.
///
/// ## Por que a tela existe
///
/// O documento só era alcançável por dentro do atendimento que o gerou. "Cadê
/// a OS de ontem?" é pergunta de todo dia em campo, e a resposta custava
/// lembrar o cliente, achar o atendimento na fila, abrir, rolar até a seção do
/// documento. Quatro toques e uma memória.
///
/// ## A mesma estrutura da tela de Atendimentos
///
/// Barra de controle elevada no topo — título, contagem, busca, recortes —,
/// conteúdo agrupado por dia em cartões, e sombra em vez de filete separando
/// os dois. Não é repetição por preguiça: é o que faz as telas parecerem o
/// mesmo produto. O que muda aqui é o fim da linha — um documento existe para
/// ser **entregue a alguém**, e por isso cada linha carrega o botão de
/// compartilhar.
///
/// ## O que ela não decide
///
/// Nada. O rótulo do tipo, a ordem, e se o arquivo está disponível ou ainda
/// sendo preparado vêm do servidor. Um documento em preparo não oferece botão
/// nenhum — oferecer e recusar seria pior do que não oferecer.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_screen_header.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/documents_providers.dart';
import '../data/documents_repository.dart';
import 'document_open_sheet.dart';

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key, this.now});

  /// O "agora" que decide o que é *hoje* e o que é *ontem*.
  ///
  /// Injetável só para captura e teste: um rótulo que depende do relógio da
  /// máquina faz a imagem de referência mudar sozinha da meia-noite para cá.
  final DateTime? now;

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  final _scroll = ScrollController();
  final _busca = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _busca.dispose();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  /// Espera a pessoa parar de digitar: sem isso, um nome de cliente dispara
  /// uma requisição por caractere e as respostas chegam fora de ordem.
  void _aoDigitar(String valor) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      final atual = ref.read(documentQueryProvider);
      final limpo = valor.trim();
      ref.read(documentQueryProvider.notifier).state = limpo.isEmpty
          ? atual.copyWith(clearSearch: true)
          : atual.copyWith(search: limpo);
      setState(() {});
    });
  }

  /// Pede a próxima página antes do fim, não no fim: quem chega ao último
  /// pixel e espera vê uma lista que trava.
  void _onScroll() {
    if (!_scroll.hasClients) return;
    final faltam = _scroll.position.maxScrollExtent - _scroll.position.pixels;
    if (faltam < 400) {
      ref.read(documentsControllerProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(documentsControllerProvider);
    final query = ref.watch(documentQueryProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      body: Column(
        children: [
          _Cabecalho(
            query: query,
            total: state.valueOrNull?.items.length ?? 0,
            busca: _busca,
            aoDigitar: _aoDigitar,
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () =>
                  ref.read(documentsControllerProvider.notifier).load(),
              child: state.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(OrbitSpacing.gutter),
                  child: SectionLoading(lines: 6),
                ),
                error: (error, _) => ListView(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  children: [
                    SectionError(
                      error: error,
                      onRetry: () =>
                          ref.read(documentsControllerProvider.notifier).load(),
                    ),
                  ],
                ),
                data: (data) =>
                    _Lista(scroll: _scroll, state: data, agora: widget.now),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* A barra de controle                                                 */
/* ------------------------------------------------------------------ */

/// Título, contagem, busca, recortes de tipo e o botão de período.
///
/// A superfície é **elevada** e a separação do conteúdo é por sombra, não por
/// filete: filete divide, sombra ordena. É a mesma barra da tela de
/// Atendimentos, com os recortes que fazem sentido aqui.
class _Cabecalho extends ConsumerWidget {
  const _Cabecalho({
    required this.query,
    required this.total,
    required this.busca,
    required this.aoDigitar,
  });

  final DocumentQuery query;
  final int total;
  final TextEditingController busca;
  final ValueChanged<String> aoDigitar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;

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
                title: 'Documentos',
                count: total == 1 ? '1 documento' : '$total documentos',
              ),
            ),

            /// A busca vem antes dos recortes: quem lembra o nome do cliente
            /// não deveria passar por filtro nenhum para achar a OS dele.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                0,
                OrbitSpacing.gutter,
                OrbitSpacing.ms,
              ),
              child: TextField(
                controller: busca,
                onChanged: aoDigitar,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Cliente ou documento',
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  suffixIcon: busca.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          tooltip: 'Limpar busca',
                          onPressed: () {
                            busca.clear();
                            aoDigitar('');
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
              trailing: _BotaoDePeriodo(
                ativo: query.from != null || query.to != null,
                onTap: () => _escolherPeriodo(context, ref, query),
              ),
              children: [
                for (final opcao in DocumentFilter.values)
                  Padding(
                    padding: const EdgeInsets.only(right: OrbitSpacing.sm),
                    child: _Chip(
                      rotulo: documentFilterLabels[opcao]!,
                      ativo: opcao == query.filter,
                      onTap: () =>
                          ref.read(documentQueryProvider.notifier).state = query
                              .copyWith(filter: opcao),
                    ),
                  ),
              ],
            ),

            /// O período ativo fica visível e removível. Guardado só dentro do
            /// seletor, ele vira "o aplicativo sumiu com meus documentos".
            if (query.from != null || query.to != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  OrbitSpacing.gutter,
                  OrbitSpacing.ms,
                  OrbitSpacing.gutter,
                  0,
                ),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: _ChipRemovivel(
                    rotulo: periodoCurto(query.from, query.to),
                    onRemove: () =>
                        ref.read(documentQueryProvider.notifier).state = query
                            .copyWith(clearDates: true),
                  ),
                ),
              ),
            const SizedBox(height: OrbitSpacing.ms),
          ],
        ),
      ),
    );
  }

  Future<void> _escolherPeriodo(
    BuildContext context,
    WidgetRef ref,
    DocumentQuery atual,
  ) async {
    final hoje = DateTime.now();
    final intervalo = await showDateRangePicker(
      context: context,
      firstDate: DateTime(hoje.year - 5),
      lastDate: DateTime(hoje.year + 1),
      initialDateRange: atual.from != null && atual.to != null
          ? DateTimeRange(start: atual.from!, end: atual.to!)
          : null,
      helpText: 'Período de emissão',
      saveText: 'Aplicar',
    );
    if (intervalo == null) return;
    ref.read(documentQueryProvider.notifier).state = atual.copyWith(
      from: intervalo.start,
      to: intervalo.end,
    );
  }
}

String periodoCurto(DateTime? de, DateTime? ate) {
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

        /// Sem `alignment`: um `Container` alinhado estica até o limite quando
        /// a largura não está restrita, e o chip vira uma barra.
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
            tooltip: 'Remover período',
          ),
        ],
      ),
    );
  }
}

class _BotaoDePeriodo extends StatelessWidget {
  const _BotaoDePeriodo({required this.ativo, required this.onTap});

  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      button: true,
      label: 'Filtrar por período',
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.ms),
          decoration: BoxDecoration(
            color: ativo ? palette.accentSoft : palette.surface,
            borderRadius: OrbitRadius.pill,
            border: Border.all(color: ativo ? palette.accent : palette.border),
          ),
          child: Icon(
            Icons.date_range_outlined,
            size: 17,
            color: ativo ? palette.accentStrong : palette.inkMuted,
          ),
        ),
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* A lista                                                             */
/* ------------------------------------------------------------------ */

class _Lista extends StatelessWidget {
  const _Lista({required this.scroll, required this.state, this.agora});

  final ScrollController scroll;
  final DocumentsState state;
  final DateTime? agora;

  @override
  Widget build(BuildContext context) {
    if (state.items.isEmpty) {
      /// Rolável mesmo vazia: sem rolagem o pull-to-refresh não tem gesto.
      return ListView(
        padding: const EdgeInsets.all(OrbitSpacing.gutter),
        children: const [
          SizedBox(height: OrbitSpacing.xl),
          OrbitEmptyState(
            icon: Icons.description_outlined,
            title: 'Nenhum documento neste recorte',
            description:
                'Ordens de serviço, PMOC e RVT aparecem aqui assim que são '
                'emitidos.',
          ),
        ],
      );
    }

    return ListView.builder(
      controller: scroll,
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        OrbitSpacing.md,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      itemCount: state.items.length + 1,
      itemBuilder: (context, index) {
        if (index == state.items.length) return _Rodape(state: state);

        final documento = state.items[index];
        final anterior = index == 0 ? null : state.items[index - 1];
        final proximo = index + 1 >= state.items.length
            ? null
            : state.items[index + 1];

        final dia = rotuloDoDia(documento.createdAt, agora: agora);
        final abreGrupo =
            anterior == null ||
            rotuloDoDia(anterior.createdAt, agora: agora) != dia;
        final fechaGrupo =
            proximo == null ||
            rotuloDoDia(proximo.createdAt, agora: agora) != dia;

        final palette = context.orbit;

        /// Cada dia é um cartão, e as linhas moram dentro dele.
        ///
        /// A lista é construída item a item — para paginar sem montar tudo —,
        /// então o cartão não envolve o grupo de fora: o contorno é desenhado
        /// por linha, e a primeira e a última arredondam as pontas. Sem isso a
        /// linha flutua solta sobre o fundo da página, que foi exatamente a
        /// reclamação da tela de Atendimentos.
        final raio = BorderRadius.vertical(
          top: abreGrupo ? const Radius.circular(16) : Radius.zero,
          bottom: fechaGrupo ? const Radius.circular(16) : Radius.zero,
        );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (abreGrupo)
              Padding(
                padding: EdgeInsets.only(
                  top: index == 0 ? 0 : OrbitSpacing.lg,
                  left: OrbitSpacing.xs,
                  bottom: OrbitSpacing.sm,
                ),
                child: Text(
                  dia.toUpperCase(),
                  style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
                ),
              ),
            DecoratedBox(
              decoration: BoxDecoration(
                color: palette.surface,
                borderRadius: raio,
                boxShadow: fechaGrupo ? OrbitShadow.card : null,
              ),
              child: ClipRRect(
                borderRadius: raio,
                child: Column(
                  children: [
                    if (!abreGrupo) const OrbitRowDivider(),
                    DocumentRow(
                      key: ValueKey(documento.artifactId),
                      document: documento,
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Hoje, ontem, ou a data por extenso.
///
/// Os dois primeiros existem porque é assim que alguém em campo pensa a data
/// do documento que acabou de emitir — "a OS de ontem", nunca "a OS de 10/09".
String rotuloDoDia(DateTime instante, {DateTime? agora}) {
  final local = instante.toLocal();
  final hoje = (agora ?? DateTime.now()).toLocal();
  final dias = DateTime(
    hoje.year,
    hoje.month,
    hoje.day,
  ).difference(DateTime(local.year, local.month, local.day)).inDays;

  if (dias == 0) return 'Hoje';
  if (dias == 1) return 'Ontem';

  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  final mes = meses[local.month - 1];
  return local.year == hoje.year
      ? '${local.day} de $mes'
      : '${local.day} de $mes de ${local.year}';
}

class _Rodape extends ConsumerWidget {
  const _Rodape({required this.state});

  final DocumentsState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.error != null) {
      return Padding(
        padding: const EdgeInsets.only(top: OrbitSpacing.md),

        /// A falha de uma página não apaga o que já está na tela.
        child: SectionError(
          error: state.error!,
          onRetry: () =>
              ref.read(documentsControllerProvider.notifier).loadMore(),
        ),
      );
    }
    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: OrbitSpacing.lg),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (state.hasNextPage) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.md),
        child: Center(
          child: TextButton(
            onPressed: () =>
                ref.read(documentsControllerProvider.notifier).loadMore(),
            child: const Text('Carregar mais'),
          ),
        ),
      );
    }
    return const SizedBox(height: OrbitSpacing.lg);
  }
}

/* ------------------------------------------------------------------ */
/* A linha                                                             */
/* ------------------------------------------------------------------ */

/// O selo de um documento.
///
/// Três casos, e a diferença entre os dois últimos importa para quem espera:
/// "preparando" resolve sozinho, "falhou" não resolve. Chamar os dois de
/// preparando deixaria a pessoa esperando um documento que nunca chega.
Widget documentStateBadge(MobileRecentDocumentContract document) =>
    switch (document.state) {
      MobileDocumentState.available => const OrbitStatusBadge(
        label: 'Disponível',
        tone: OrbitTone.success,
      ),
      MobileDocumentState.preparing => const OrbitStatusBadge(
        label: 'Preparando',
        tone: OrbitTone.warning,
      ),
      MobileDocumentState.failed => const OrbitStatusBadge(
        label: 'Falhou',
        tone: OrbitTone.danger,
      ),
    };

/// A marca do tipo, na caixa da esquerda.
///
/// Cor e ícone por tipo porque quem procura "a OS" varre a coluna da esquerda
/// antes de ler qualquer texto. Um PDF genérico em todas as linhas obriga a
/// ler todas elas.
({IconData icone, OrbitTone tom}) _marcaDoTipo(String tipo) => switch (tipo) {
  'SERVICE_ORDER' => (icone: Icons.assignment_outlined, tom: OrbitTone.info),
  'PMOC' => (icone: Icons.event_repeat_outlined, tom: OrbitTone.intelligence),
  'RVT' => (icone: Icons.fact_check_outlined, tom: OrbitTone.success),
  'RECEIPT' => (icone: Icons.receipt_long_outlined, tom: OrbitTone.warning),
  'QUOTE' => (icone: Icons.request_quote_outlined, tom: OrbitTone.warning),
  _ => (icone: Icons.picture_as_pdf_outlined, tom: OrbitTone.neutral),
};

/// Uma linha de documento.
///
/// O toque abre a folha com tudo; o botão da direita é o atalho para o que
/// mais se faz com um documento — mandar para o cliente. Dois caminhos para a
/// mesma coisa não é redundância: um é para quem quer conferir antes, o outro
/// para quem já sabe o que está mandando.
class DocumentRow extends ConsumerStatefulWidget {
  const DocumentRow({super.key, required this.document});

  final MobileRecentDocumentContract document;

  @override
  ConsumerState<DocumentRow> createState() => _DocumentRowState();
}

class _DocumentRowState extends ConsumerState<DocumentRow> {
  bool _compartilhando = false;

  Future<void> _compartilhar() async {
    if (_compartilhando) return;
    setState(() => _compartilhando = true);
    try {
      await compartilharDocumento(context, ref, widget.document);
    } finally {
      if (mounted) setState(() => _compartilhando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final documento = widget.document;
    final marca = _marcaDoTipo(documento.documentType);

    /// Acima de 1.3× a linha deixa de ser horizontal: não sobra largura para
    /// nome e hora dividirem a mesma faixa.
    final empilhado = MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final cor = switch (marca.tom) {
      OrbitTone.info => palette.accent,
      OrbitTone.success => palette.success,
      OrbitTone.warning => palette.warning,
      OrbitTone.danger => palette.danger,
      OrbitTone.intelligence => palette.intelligence,
      OrbitTone.neutral => palette.inkMuted,
    };

    return Material(
      color: palette.surface,
      child: InkWell(
        onTap: () => showDocumentOpenSheet(context, documento),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.md,
            vertical: OrbitSpacing.ms,
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: cor.withValues(alpha: 0.10),
                  borderRadius: OrbitRadius.field,
                ),
                child: Icon(marca.icone, size: 21, color: cor),
              ),
              const SizedBox(width: OrbitSpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    /// A hora tem coluna própria, e não vai concatenada no
                    /// rótulo: junto, ela era a primeira coisa a ser cortada
                    /// por reticências — "Ordem de serviço 2026-0148 · 0…" —,
                    /// e uma hora pela metade não informa nada.
                    ///
                    /// Com o texto ampliado ela desce de linha. Lado a lado,
                    /// sobravam 60 pixels para o nome do cliente e
                    /// "Shopping Recife" virava "Sh…" — o dado mais
                    /// importante da linha, apagado para caber um horário.
                    /// Texto grande pede mais altura, não menos conteúdo.
                    if (empilhado)
                      Text(
                        documento.customerName ?? documento.label,
                        style: OrbitType.itemTitle.copyWith(color: palette.ink),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      )
                    else
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Expanded(
                            child: Text(
                              documento.customerName ?? documento.label,
                              style: OrbitType.itemTitle.copyWith(
                                color: palette.ink,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: OrbitSpacing.sm),
                          Text(
                            OrbitFormat.hourOf(documento.createdAt),
                            style: OrbitType.numeric.copyWith(
                              fontSize: 12.5,
                              color: palette.inkSubtle,
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: 3),
                    Text(
                      documento.label,
                      style: OrbitType.caption.copyWith(
                        color: palette.inkMuted,
                      ),
                      maxLines: empilhado ? 2 : 1,
                      overflow: TextOverflow.ellipsis,
                    ),

                    /// Em linha própria, e não colada no rótulo: junto, a
                    /// hora voltava a ser o pedaço cortado. O rótulo pode
                    /// perder o fim — o ícone à esquerda já diz o tipo.
                    if (empilhado)
                      Text(
                        OrbitFormat.hourOf(documento.createdAt),
                        style: OrbitType.numeric.copyWith(
                          fontSize: 12.5,
                          color: palette.inkSubtle,
                        ),
                      ),

                    /// O selo só aparece quando **não** é o caso comum. Um
                    /// "Disponível" verde em toda linha vira ruído e some
                    /// justamente quando um "Preparando" precisaria saltar.
                    if (!documento.isAvailable) ...[
                      const SizedBox(height: 6),
                      documentStateBadge(documento),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: OrbitSpacing.sm),

              /// A caixa tem largura fixa nos dois casos. Sem isso a coluna
              /// das horas dança meia dezena de pixels entre a linha que tem
              /// botão e a que tem só a seta.
              SizedBox(
                width: 38,
                child: documento.isAvailable
                    ? _AcaoDaLinha(
                        ocupado: _compartilhando,
                        onTap: _compartilhar,
                      )
                    : Icon(
                        Icons.chevron_right,
                        size: 18,
                        color: palette.inkSubtle,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AcaoDaLinha extends StatelessWidget {
  const _AcaoDaLinha({required this.ocupado, required this.onTap});

  final bool ocupado;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Tooltip(
      message: 'Compartilhar',
      child: InkResponse(
        onTap: ocupado ? null : onTap,
        radius: 24,
        child: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: palette.accentSoft,
            borderRadius: OrbitRadius.pill,
          ),
          child: ocupado
              ? Padding(
                  padding: const EdgeInsets.all(11),
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: palette.accentStrong,
                  ),
                )
              : Icon(
                  Icons.ios_share_rounded,
                  size: 18,
                  color: palette.accentStrong,
                ),
        ),
      ),
    );
  }
}
