/// Meu dia — a tela inicial de quem trabalha em campo.
///
/// ## A pergunta que ela responde
///
/// **"O que eu preciso fazer agora?"** — nessa ordem, de cima para baixo:
///
/// ```text
/// 1. quem é você, e que dia é hoje
/// 2. o que já começou           → o trabalho ao qual se volta
/// 3. o que dá para fazer daqui  → ações rápidas
/// 4. o que é de hoje            → a agenda, resumida
/// 5. o que vem depois           → os próximos
/// 6. o que ficou pronto         → documentos e compromissos recentes
/// ```
///
/// A versão anterior abria com quatro contadores. Contador informa; ele não
/// diz o que fazer. Aqui as contagens continuam existindo — mas como **rótulo
/// da seção**, ao lado do trabalho a que se referem, e não como cartaz.
///
/// ## Uma requisição
///
/// `GET /mobile/field/home` entrega painel, documentos recentes e compromissos
/// recentes juntos. Montar isso no aplicativo custaria uma chamada por
/// atendimento da fila — a cascata que a tela existia para evitar e voltava a
/// criar assim que ganhasse a terceira seção.
///
/// Nada é contado, classificado ou reordenado aqui: `counters`, `next`,
/// `inProgress`, `overdue`, `today` e o estado de cada documento vêm prontos.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_operational.dart';
import '../../../core/errors/orbit_public_copy.dart';
import 'package:intl/intl.dart';

import '../../../core/contracts/notification_contracts.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../authentication/domain/session.dart';
import '../../documents/presentation/documents_screen.dart'
    show documentStateBadge;
import '../../operations/data/operations_repository.dart' show CachedResult;
import '../../equipment/presentation/equipment_scanner_screen.dart';
import '../../notifications/application/notification_providers.dart';
import '../../notifications/domain/deep_link.dart';
import '../../profile/presentation/my_avatar.dart';
import '../application/field_providers.dart';
import 'widgets/work_item_row.dart';

class FieldDashboardScreen extends ConsumerWidget {
  const FieldDashboardScreen({super.key, this.now});

  /// Relógio visual da saudação. Em produção usa o horário local do aparelho;
  /// testes de imagem podem fixá-lo para não transformar a data em ruído.
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final home = ref.watch(fieldHomeProvider);
    final session = ref.watch(sessionProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(fieldHomeProvider),

          /// O que já está na tela sobrevive a um refresh que falha.
          ///
          /// `when` trocaria o dia inteiro de trabalho por uma tela de erro
          /// porque a rede caiu no meio de um gesto de puxar. Quem está em
          /// campo perderia a fila, os horários e o próximo atendimento — que
          /// continuam válidos, só não foram atualizados.
          ///
          /// Com dado em mãos, a falha vira um aviso. Sem dado, aí sim a tela
          /// é o erro: não há o que preservar.
          child: _corpo(ref, home, session, now: now),
        ),
      ),
    );
  }
}

/// O que mostrar, dado o estado da leitura.
///
/// A ordem das perguntas é o comportamento: **primeiro** se há dado. Só quando
/// não há é que a falha ocupa a tela.
Widget _corpo(
  WidgetRef ref,
  AsyncValue<CachedResult<MobileFieldHomeContract>> home,
  OrbitSession? session, {
  DateTime? now,
}) {
  final dados = home.valueOrNull;
  if (dados != null) {
    return _Home(
      home: dados.value,
      cachedAt: dados.cachedAt,
      userName: session?.user.displayName,
      avatarUrl: session?.user.avatarUrl,
      unitName: session?.businessUnit?.name,
      currentUserId: session?.user.id,
      now: now,
      refreshFailed: home.hasError,
    );
  }

  if (home.hasError) {
    /// A lista precisa rolar mesmo no erro: sem rolagem, o `RefreshIndicator`
    /// não tem gesto, e a única saída seria fechar o aplicativo.
    return ListView(
      padding: const EdgeInsets.all(OrbitSpacing.gutter),
      children: [
        SectionError(
          error: home.error!,
          onRetry: () => ref.invalidate(fieldHomeProvider),
        ),
      ],
    );
  }

  return const Padding(
    padding: EdgeInsets.all(OrbitSpacing.gutter),
    child: SectionLoading(lines: 6),
  );
}

class _Home extends ConsumerWidget {
  const _Home({
    required this.home,
    required this.cachedAt,
    required this.userName,
    this.avatarUrl,
    this.unitName,
    required this.currentUserId,
    this.now,
    this.refreshFailed = false,
  });

  final MobileFieldHomeContract home;
  final DateTime? cachedAt;
  final String? userName;
  final String? avatarUrl;
  final String? unitName;
  final String? currentUserId;
  final DateTime? now;

  /// A última atualização não veio. Os dados abaixo continuam sendo os
  /// últimos que o servidor confirmou.
  final bool refreshFailed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = home.dashboard;
    final c = dashboard.counters;

    /// Os avisos chegam por uma leitura própria, em paralelo.
    ///
    /// Encadeá-los ao painel atrasaria a abertura pela soma das duas
    /// requisições. Enquanto não chegam, a faixa simplesmente não existe —
    /// um esqueleto cinza no topo é pior que nada ali.
    final avisos = ref.watch(notificationsProvider).valueOrNull?.value;

    /// O destaque: o atendimento que já começou. Um por tela.
    final emAndamento = dashboard.inProgress.isEmpty
        ? null
        : dashboard.inProgress.first;

    final semTrabalho =
        dashboard.inProgress.isEmpty &&
        dashboard.overdue.isEmpty &&
        dashboard.today.isEmpty &&
        dashboard.next == null &&
        home.recentlyCompleted.isEmpty;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl2,
      ),
      children: [
        /// Linha 1 — quem está usando, e o que dá para fazer sem descer.
        _Header(
          userName: userName,
          avatarUrl: avatarUrl,
          unitName: unitName,
          now: now,
          unread: avisos?.unread ?? 0,
        ),

        if (cachedAt != null)
          Padding(
            padding: const EdgeInsets.only(bottom: OrbitSpacing.ms),
            child: StaleDataBanner(cachedAt: cachedAt!),
          ),
        if (refreshFailed) const _RefreshFailedNotice(),

        /// Linha 2 — avisos. Só aparece quando há o que avisar.
        if (avisos != null && avisos.data.isNotEmpty) ...[
          _AnnouncementCarousel(items: avisos.data),
          const SizedBox(height: OrbitSpacing.lg),
        ],

        /// Linha 3 — o dia em quatro números, dois por linha.
        _KpiGrid(
          items: [
            _KpiData(
              value: '${c.today}',
              label: 'Hoje',
              icon: Icons.today_outlined,
              tone: OrbitTone.info,
              onTap: () => context.go(OrbitRoutes.agenda),
            ),
            _KpiData(
              value: '${c.overdue}',
              label: 'Atrasadas',
              icon: Icons.error_outline,
              tone: c.overdue > 0 ? OrbitTone.danger : OrbitTone.neutral,
              onTap: () => context.go(OrbitRoutes.workQueue),
            ),
            _KpiData(
              value: '${c.inProgress}',
              label: 'Em andamento',
              icon: Icons.play_circle_outline,
              tone: c.inProgress > 0 ? OrbitTone.warning : OrbitTone.neutral,
              onTap: () => context.go(OrbitRoutes.workQueue),
            ),
            _KpiData(
              value: '${c.upcoming}',
              label: 'Próximas',
              icon: Icons.event_outlined,
              tone: OrbitTone.neutral,
              onTap: () => context.go(OrbitRoutes.workQueue),
            ),
          ],
        ),
        const SizedBox(height: OrbitSpacing.lg),

        /// O que fazer agora. Um destaque por tela, e só quando há um.
        if (emAndamento != null) ...[
          OrbitHeroCard(
            eyebrow: 'Em andamento',
            title: emAndamento.customer?.name ?? emAndamento.title,
            subtitle: emAndamento.customer == null ? null : emAndamento.title,
            meta: _metaDoDestaque(emAndamento),
            onTap: () =>
                context.push(OrbitRoutes.workItemDetail(emAndamento.id)),
            action: OrbitHeroButton(
              label: 'Retomar atendimento',
              icon: Icons.play_arrow_rounded,
              onPressed: () =>
                  context.push(OrbitRoutes.workItemDetail(emAndamento.id)),
            ),
          ),
          const SizedBox(height: OrbitSpacing.lg),
        ],

        /// Linha 4 — quatro acessos, numa fileira só.
        _QuickActions(dashboard: dashboard),
        const SizedBox(height: OrbitSpacing.lg),

        /// Linha 5 — os cinco mais recentes, com o recorte escolhido.
        if (semTrabalho)
          const OrbitEmptyState(
            icon: Icons.event_available_outlined,
            title: 'Nenhum atendimento programado',
            description:
                'Quando houver trabalho atribuído a você, ele aparece aqui.',
          )
        else
          _RecentWork(home: home, currentUserId: currentUserId),

        if (home.recentDocuments.isNotEmpty) ...[
          const SizedBox(height: OrbitSpacing.lg),
          OrbitSection(
            title: 'Documentos recentes',
            actionLabel: 'Ver todos',
            action: () => context.go(OrbitRoutes.documents),
            padding: EdgeInsets.zero,
            child: _Rows(
              children: [
                for (final documento in home.recentDocuments)
                  _DocumentRow(document: documento),
              ],
            ),
          ),
        ],
      ],
    );
  }

  /// A linha de contexto do destaque: horário, equipamento e unidade.
  static String? _metaDoDestaque(MobileWorkItemContract item) {
    final partes = [
      scheduleText(item),
      if (item.equipmentSummary.isNotEmpty)
        equipmentText(item.equipmentSummary),
      item.businessUnit.name,
    ].where((parte) => parte.isNotEmpty).toList();
    return partes.isEmpty ? null : partes.join(' · ');
  }
}

/// Linha 2 — os avisos, um de cada vez.
///
/// ## Por que carrossel, e não lista
///
/// Aviso empilhado vira parede: três cartões no topo empurram o trabalho para
/// fora da tela, e a pessoa aprende a rolar sem ler. Um de cada vez cabe, e os
/// pontos abaixo dizem que há mais.
///
/// Só o texto e o caminho para o detalhe. O corpo inteiro de uma notificação
/// não cabe aqui e não é para caber — quem quer o detalhe toca.
class _AnnouncementCarousel extends StatefulWidget {
  const _AnnouncementCarousel({required this.items});

  final List<OrbitNotification> items;

  @override
  State<_AnnouncementCarousel> createState() => _AnnouncementCarouselState();
}

class _AnnouncementCarouselState extends State<_AnnouncementCarousel> {
  late final PageController _controller = PageController();
  int _atual = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final itens = widget.items.take(5).toList();

    /// A altura acompanha a escala de texto.
    ///
    /// Fixar 86 pixels funciona em 1.0x e corta a segunda linha em 2.0x —
    /// quem aumenta a fonte do sistema é justamente quem não consegue ler o
    /// que foi cortado.
    final escala = MediaQuery.textScalerOf(context).scale(1);
    final altura = 86.0 + (escala - 1).clamp(0, 1.5) * 52;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: altura,
          child: PageView.builder(
            controller: _controller,
            itemCount: itens.length,
            onPageChanged: (indice) => setState(() => _atual = indice),
            itemBuilder: (context, indice) {
              final aviso = itens[indice];
              return Padding(
                padding: EdgeInsets.only(
                  right: indice == itens.length - 1 ? 0 : OrbitSpacing.sm,
                ),
                child: OrbitCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: OrbitSpacing.md,
                    vertical: OrbitSpacing.ms,
                  ),
                  onTap: () {
                    /// O servidor publica o destino no `payload`. Quando ele
                    /// não sabe traduzir, a caixa de avisos é a resposta
                    /// certa — melhor que abrir a tela errada.
                    final destino = routeForNotificationPayload(aviso.payload);
                    context.push(destino ?? OrbitRoutes.notifications);
                  },
                  child: Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: aviso.isUnread
                              ? palette.accentSoft
                              : palette.surfaceMuted,
                          borderRadius: OrbitRadius.chip,
                        ),
                        child: Icon(
                          Icons.campaign_outlined,
                          size: 18,
                          color: aviso.isUnread
                              ? palette.accent
                              : palette.inkSubtle,
                        ),
                      ),
                      const SizedBox(width: OrbitSpacing.ms),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              aviso.title,
                              style: OrbitType.label.copyWith(
                                color: palette.ink,
                                fontSize: 13.5,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Text(
                              aviso.body,
                              style: OrbitType.caption.copyWith(
                                color: palette.inkSubtle,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: OrbitSpacing.sm),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 20,
                        color: palette.inkDisabled,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        if (itens.length > 1) ...[
          const SizedBox(height: OrbitSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < itens.length; i += 1)
                Container(
                  width: i == _atual ? 16 : 6,
                  height: 6,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(
                    color: i == _atual ? palette.accent : palette.borderStrong,
                    borderRadius: OrbitRadius.pill,
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Os dados de um indicador.
class _KpiData {
  const _KpiData({
    required this.value,
    required this.label,
    required this.icon,
    required this.tone,
    this.onTap,
  });

  final String value;
  final String label;
  final IconData icon;
  final OrbitTone tone;
  final VoidCallback? onTap;
}

/// Linha 3 — quatro indicadores, dois por linha.
///
/// ## Por que não é a faixa de quatro colunas
///
/// Quatro números lado a lado em 360 pixels deixam 78 para cada rótulo, e
/// "Em andamento" quebra no meio da palavra. Dois por linha dão espaço para o
/// ícone, o número grande e o rótulo inteiro — e é o formato que os painéis
/// de produto usam quando o indicador precisa ser tocável.
class _KpiGrid extends StatelessWidget {
  const _KpiGrid({required this.items});

  final List<_KpiData> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var linha = 0; linha < items.length; linha += 2) ...[
          if (linha > 0) const SizedBox(height: OrbitSpacing.ms),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _KpiTile(data: items[linha])),
                if (linha + 1 < items.length) ...[
                  const SizedBox(width: OrbitSpacing.ms),
                  Expanded(child: _KpiTile(data: items[linha + 1])),
                ] else
                  const Spacer(),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({required this.data});

  final _KpiData data;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final (Color forte, Color suave) = switch (data.tone) {
      OrbitTone.info => (palette.accent, palette.accentSoft),
      OrbitTone.success => (palette.success, palette.successSoft),
      OrbitTone.warning => (palette.warning, palette.warningSoft),
      OrbitTone.danger => (palette.danger, palette.dangerSoft),
      OrbitTone.intelligence => (
        palette.intelligence,
        palette.intelligenceSoft,
      ),
      OrbitTone.neutral => (palette.inkMuted, palette.surfaceMuted),
    };

    return Semantics(
      button: data.onTap != null,
      label: '${data.label}: ${data.value}',
      excludeSemantics: true,
      child: OrbitCard(
        onTap: data.onTap,
        padding: const EdgeInsets.all(OrbitSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: suave,
                    borderRadius: OrbitRadius.chip,
                  ),
                  child: Icon(data.icon, size: 16, color: forte),
                ),
                const Spacer(),
                Text(
                  data.value,
                  style: OrbitType.metric.copyWith(
                    color: data.tone == OrbitTone.neutral ? palette.ink : forte,
                  ),
                ),
              ],
            ),
            const SizedBox(height: OrbitSpacing.sm),
            Text(
              data.label,
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

/// O recorte da lista de recentes.
enum _RecentTab { abertos, proximos, concluidos }

/// Linha 5 — os cinco atendimentos mais recentes, no recorte escolhido.
///
/// ## De onde vem cada aba
///
/// "Abertos" e "Próximos" saem do próprio payload da home — já vieram
/// classificados pelo servidor. "Concluídos" é uma leitura à parte
/// (`recentlyCompleted`): a fila de trabalho lista o que **falta**, e a
/// consulta dela exclui concluídos. Forçar concluído na fila mudaria a
/// semântica de `dueState`, que o aplicativo inteiro lê, por um motivo de
/// tela.
class _RecentWork extends StatefulWidget {
  const _RecentWork({required this.home, this.currentUserId});

  final MobileFieldHomeContract home;
  final String? currentUserId;

  @override
  State<_RecentWork> createState() => _RecentWorkState();
}

class _RecentWorkState extends State<_RecentWork> {
  _RecentTab _aba = _RecentTab.abertos;

  @override
  Widget build(BuildContext context) {
    final dashboard = widget.home.dashboard;

    /// Abertos é tudo que está pendente, na ordem em que pesa: o que atrasou
    /// primeiro, depois o que começou, depois o dia.
    final abertos = <MobileWorkItemContract>[
      ...dashboard.overdue,
      ...dashboard.inProgress,
      ...dashboard.today,
    ];
    final vistos = <String>{};
    final abertosUnicos = [
      for (final item in abertos)
        if (vistos.add(item.id)) item,
    ].take(5).toList();

    final proximos = dashboard.next == null
        ? const <MobileWorkItemContract>[]
        : [dashboard.next!];
    final concluidos = widget.home.recentlyCompleted.take(5).toList();

    final (rotulo, destino) = switch (_aba) {
      _RecentTab.abertos => ('Ver todos', OrbitRoutes.workQueue),
      _RecentTab.proximos => ('Ver agenda', OrbitRoutes.agenda),
      _RecentTab.concluidos => ('Ver documentos', OrbitRoutes.documents),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(
            left: OrbitSpacing.xs,
            bottom: OrbitSpacing.ms,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Atendimentos',
                  style: OrbitType.sectionTitle.copyWith(
                    color: context.orbit.ink,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => context.go(destino),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: OrbitSpacing.sm,
                  ),
                  minimumSize: const Size(0, 36),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(rotulo),
              ),
            ],
          ),
        ),

        _RecentTabs(
          atual: _aba,
          onChanged: (aba) => setState(() => _aba = aba),
          contagens: {
            _RecentTab.abertos: abertosUnicos.length,
            _RecentTab.proximos: proximos.length,
            _RecentTab.concluidos: concluidos.length,
          },
        ),
        const SizedBox(height: OrbitSpacing.ms),

        OrbitCard(
          padding: EdgeInsets.zero,
          child: switch (_aba) {
            _RecentTab.abertos => _listaDeItens(abertosUnicos, 'aberto'),
            _RecentTab.proximos => _listaDeItens(proximos, 'programado'),
            _RecentTab.concluidos => _listaDeConcluidos(concluidos),
          },
        ),
      ],
    );
  }

  Widget _listaDeItens(List<MobileWorkItemContract> itens, String vazio) {
    if (itens.isEmpty) return _vazio('Nenhum atendimento $vazio agora.');
    return _Rows(
      children: [
        for (final item in itens)
          WorkItemRow(
            key: ValueKey(item.id),
            item: item,
            currentUserId: widget.currentUserId,
            onOpen: () => context.push(OrbitRoutes.workItemDetail(item.id)),
          ),
      ],
    );
  }

  Widget _listaDeConcluidos(List<MobileCompletedWorkContract> itens) {
    if (itens.isEmpty) return _vazio('Nenhum atendimento concluído ainda.');
    return _Rows(
      children: [
        for (final item in itens)
          OrbitListRow(
            key: ValueKey(item.id),
            leading: OrbitFormat.weekdayAndDay(item.completedAt),
            title: item.customerName ?? item.title,
            subtitle: item.customerName == null ? null : item.title,
            detail: [
              item.code,
              if (item.equipmentName != null) item.equipmentName!,
            ].join(' · '),
            trailing: const OrbitStatusBadge(
              label: 'Concluído',
              tone: OrbitTone.success,
            ),
            onTap: () => context.push(OrbitRoutes.operationDetail(item.id)),
          ),
      ],
    );
  }

  Widget _vazio(String mensagem) => Padding(
    padding: const EdgeInsets.symmetric(
      horizontal: OrbitSpacing.ml,
      vertical: OrbitSpacing.lg,
    ),
    child: Text(
      mensagem,
      style: OrbitType.body.copyWith(color: context.orbit.inkSubtle),
      textAlign: TextAlign.center,
    ),
  );
}

/// As três abas do recorte.
class _RecentTabs extends StatelessWidget {
  const _RecentTabs({
    required this.atual,
    required this.onChanged,
    required this.contagens,
  });

  final _RecentTab atual;
  final ValueChanged<_RecentTab> onChanged;
  final Map<_RecentTab, int> contagens;

  static const _rotulos = <_RecentTab, String>{
    _RecentTab.abertos: 'Abertos',
    _RecentTab.proximos: 'Próximos',
    _RecentTab.concluidos: 'Concluídos',
  };

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: palette.surfaceSunken,
        borderRadius: OrbitRadius.pill,
      ),
      child: Row(
        children: [
          for (final aba in _RecentTab.values)
            Expanded(
              child: Semantics(
                selected: aba == atual,
                button: true,
                child: GestureDetector(
                  onTap: () => onChanged(aba),
                  behavior: HitTestBehavior.opaque,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    decoration: BoxDecoration(
                      color: aba == atual ? palette.surface : null,
                      borderRadius: OrbitRadius.pill,
                      boxShadow: aba == atual ? OrbitShadow.card : null,
                    ),
                    child: Text(
                      _rotulos[aba]!,
                      textAlign: TextAlign.center,
                      style: OrbitType.label.copyWith(
                        fontSize: 13,
                        color: aba == atual ? palette.ink : palette.inkSubtle,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Linha 1 — quem está usando, e o que dá para fazer sem descer a tela.
///
/// ## Por que o avatar fica aqui
///
/// Não é enfeite: é a confirmação de **em nome de quem** as ações vão sair.
/// Quem opera com o telefone de outra pessoa, ou troca de unidade no meio do
/// dia, precisa dessa âncora antes de tocar em qualquer botão.
///
/// O sino carrega a contagem que o servidor mandou, não uma soma feita aqui:
/// contar as não lidas da página traria o número da página, não o total.
class _Header extends StatelessWidget {
  const _Header({
    required this.userName,
    this.avatarUrl,
    this.unitName,
    this.now,
    this.unread = 0,
  });

  final String? userName;
  final String? avatarUrl;
  final String? unitName;
  final DateTime? now;
  final int unread;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final agora = now ?? DateTime.now();
    final primeiroNome = userName?.trim().split(' ').first;

    return Padding(
      padding: const EdgeInsets.only(
        top: OrbitSpacing.md,
        bottom: OrbitSpacing.lg,
      ),
      child: Row(
        children: [
          MyAvatar(initials: _iniciais(userName), size: 46),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  greetingFor(agora.hour, primeiroNome),
                  style: OrbitType.itemTitle.copyWith(
                    color: palette.ink,
                    fontSize: 17,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 1),
                Text(
                  [
                    todayShort(agora),
                    if (unitName != null) unitName!,
                  ].join(' · '),
                  style: OrbitType.caption.copyWith(color: palette.inkSubtle),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),

          _HeaderAction(
            icon: Icons.notifications_none_rounded,
            label: 'Notificações',
            badge: unread,
            onTap: () => context.push(OrbitRoutes.notifications),
          ),
        ],
      ),
    );
  }
}

/// Um botão de ação do cabeçalho, com contador opcional.
class _HeaderAction extends StatelessWidget {
  const _HeaderAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.badge = 0,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      button: true,
      label: badge > 0 ? '$label, $badge não lidas' : label,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(left: OrbitSpacing.sm),
        child: InkResponse(
          onTap: onTap,
          radius: 24,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: palette.surface,
                  borderRadius: OrbitRadius.chip,
                  border: Border.all(color: palette.border),
                ),
                child: Icon(icon, size: 20, color: palette.ink),
              ),
              if (badge > 0)
                Positioned(
                  top: -3,
                  right: -3,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    constraints: const BoxConstraints(minWidth: 18),
                    decoration: BoxDecoration(
                      color: palette.danger,
                      borderRadius: OrbitRadius.pill,
                      border: Border.all(color: palette.background, width: 1.5),
                    ),
                    child: Text(
                      badge > 99 ? '99+' : '$badge',
                      textAlign: TextAlign.center,
                      style: OrbitType.label.copyWith(
                        color: Colors.white,
                        fontSize: 10.5,
                      ),
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

/// As iniciais de quem está usando — duas, no máximo.
String _iniciais(String? nome) {
  final partes = (nome ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((parte) => parte.isNotEmpty)
      .toList();
  if (partes.isEmpty) return '?';
  if (partes.length == 1) return partes.first.characters.first.toUpperCase();
  return (partes.first.characters.first + partes.last.characters.first)
      .toUpperCase();
}

/// A saudação, pelo relógio de quem lê.
String greetingFor(int hour, String? name) {
  final saudacao = switch (hour) {
    >= 5 && < 12 => 'Bom dia',
    >= 12 && < 18 => 'Boa tarde',
    _ => 'Boa noite',
  };
  return name == null || name.isEmpty ? saudacao : '$saudacao, $name';
}

/// A data de hoje, por extenso e curta.
String todayLabel(DateTime now) => OrbitFormat.weekdayAndDay(now);

/// A mesma data, curta, para dividir a linha com o nome da unidade.
///
/// "terça-feira, 08 de setembro · Unidade Recife" não cabe em 390 pixels, e o
/// que some na reticência é justamente a unidade — o dado que diz de onde as
/// ações vão sair.
String todayShort(DateTime now) =>
    DateFormat('E, d MMM', 'pt_BR').format(now).replaceAll('.', '');

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.dashboard});

  final MobileFieldDashboardContract dashboard;

  @override
  Widget build(BuildContext context) {
    final acoes = <Widget>[
      OrbitQuickAction(
        icon: Icons.checklist_rtl_outlined,
        label: 'Atendimentos',
        onTap: () => context.go(OrbitRoutes.workQueue),
      ),
      OrbitQuickAction(
        icon: Icons.calendar_today_outlined,
        label: 'Agenda',
        onTap: () => context.go(OrbitRoutes.agenda),
      ),

      /// Ler etiqueta só aparece quando o servidor permite. A capacidade é
      /// dele; esconder o botão é a tela obedecendo, não decidindo.
      if (dashboard.canScanEquipment)
        OrbitQuickAction(
          icon: Icons.qr_code_scanner,
          label: 'QR',

          /// A câmera precisa da tela inteira; o **resultado** não. O leitor
          /// devolve o token e o equipamento aparece numa folha por cima da
          /// home — quem só queria saber "que equipamento é este" não troca
          /// de contexto por uma pergunta de dois segundos.
          onTap: () async {
            final token = await context.push<String>(
              OrbitRoutes.scanner,
              extra: const EquipmentScannerRequest(returnsToken: true),
            );
            if (token == null || !context.mounted) return;
            await showEquipmentSheet(context, token);
          },
        ),
      /// PMOC **não** é atalho daqui.
      ///
      /// Era, e abria a base de contratos da organização para quem entra neste
      /// aplicativo — inclusive para o operador, que aparecia com o botão na
      /// home sem ter nada de PMOC atribuído a si. Navegar por contratos é
      /// trabalho de quem gerencia, e isso se faz no painel.
      ///
      /// O operador chega ao PMOC pelo caminho que corresponde ao trabalho dele:
      /// o atendimento atribuído, na fila, que abre a execução daquele
      /// equipamento (`work_item_detail_screen` → `pmocAttendance`). Quem não
      /// recebeu nada não tem por onde entrar — e é essa a regra.
      OrbitQuickAction(
        icon: Icons.description_outlined,
        label: 'Documentos',
        onTap: () => context.go(OrbitRoutes.documents),
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final columns = scale > 1.7
            ? 1
            : scale > 1.2
            ? 2
            : acoes.length;
        return Wrap(
          children: [
            for (final action in acoes)
              SizedBox(width: constraints.maxWidth / columns, child: action),
          ],
        );
      },
    );
  }
}

class _Rows extends StatelessWidget {
  const _Rows({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (indice, filho) in children.indexed) ...[
        if (indice > 0) const OrbitRowDivider(),
        filho,
      ],
    ],
  );
}

class _DocumentRow extends StatelessWidget {
  const _DocumentRow({required this.document});

  final MobileRecentDocumentContract document;

  @override
  Widget build(BuildContext context) => OrbitServiceRow(
    icon: Icons.picture_as_pdf_outlined,
    title: document.label,
    subtitle: document.customerName,
    detail: OrbitFormat.dateHourOf(document.createdAt),
    status: documentStateBadge(document),
    onTap: () => context.go(OrbitRoutes.documents),
  );
}

class _RefreshFailedNotice extends StatelessWidget {
  const _RefreshFailedNotice();

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.md,
        0,
        OrbitSpacing.md,
        OrbitSpacing.sm,
      ),
      child: Semantics(
        liveRegion: true,
        child: Row(
          children: [
            Icon(Icons.cloud_off_outlined, size: 16, color: palette.warning),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: Text(
                OrbitPublicCopy.refreshFailed,
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
