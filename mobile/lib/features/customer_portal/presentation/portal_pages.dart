/// As três páginas do cliente: Início, Equipamentos e Documentos.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/portal_providers.dart';
import '../application/portal_session.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';
import 'portal_detail_sheets.dart';
import 'portal_widgets.dart';
import 'service_requests_page.dart';

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */

/// O resumo e a linha do tempo dos atendimentos.
///
/// É a pergunta que o cliente traz ao abrir: "o técnico já veio? quando vem?"
/// — por isso a lista é de atendimentos, do mais recente para trás.
class PortalHomePage extends ConsumerWidget {
  const PortalHomePage({super.key, required this.onOpenTab});

  /// Os números do resumo levam às outras páginas.
  final void Function(int tab) onOpenTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final me = ref.watch(portalMeProvider);
    final resumo = ref.watch(portalSummaryProvider);
    final atendimentos = ref.watch(portalRecentOperationsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(portalSummaryProvider)
          ..invalidate(portalRecentOperationsProvider);
        await ref.read(portalRecentOperationsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.md,
          OrbitSpacing.gutter,
          OrbitSpacing.xl,
        ),
        children: [
          Text('Olá,', style: OrbitType.body.copyWith(color: palette.inkMuted)),
          Text(
            me?.displayName ?? '',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: OrbitType.screenTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            'Acompanhe seus equipamentos, atendimentos e documentos com ${me?.organizationName ?? 'a empresa que atende você'}.',
            style: OrbitType.caption.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.lg),
          resumo.when(
            loading: () => const SectionLoading(lines: 2),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(portalSummaryProvider),
            ),
            data: (dados) => PortalCard(
              padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
              child: OrbitMetricStrip(
                metrics: [
                  OrbitMetricData(
                    value: '${dados.assets}',
                    label: 'Equipamentos',
                    onTap: () => onOpenTab(2),
                  ),
                  OrbitMetricData(
                    value: '${dados.availableDocuments}',
                    label: 'Documentos',
                    onTap: () => onOpenTab(3),
                  ),
                  OrbitMetricData(
                    value: '${dados.upcomingVisits}',
                    label: 'Visitas previstas',
                    tone: dados.upcomingVisits > 0
                        ? OrbitTone.info
                        : OrbitTone.neutral,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: OrbitSpacing.md),
          _AjudaCard(onAbrir: () => openNewServiceRequest(context)),
          const SizedBox(height: OrbitSpacing.lg),
          OrbitSection(
            title: 'Atendimentos',
            count: atendimentos.valueOrNull?.total,
            child: atendimentos.when(
              loading: () => const SectionLoading(lines: 4),
              error: (error, _) => SectionError(
                error: error,
                onRetry: () => ref.invalidate(portalRecentOperationsProvider),
              ),
              data: (page) => page.items.isEmpty
                  ? const SectionEmpty(
                      icon: Icons.event_available_outlined,
                      message:
                          'Nenhum atendimento ainda. Quando houver, ele aparece aqui com a data e o técnico.',
                    )
                  : PortalCardList(
                      children: [
                        for (final operacao in page.items)
                          PortalOperationCard(
                            operation: operacao,
                            onTap: () =>
                                showPortalOperationSheet(context, operacao.id),
                          ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Equipamentos                                                        */
/* ------------------------------------------------------------------ */

class PortalEquipmentPage extends ConsumerStatefulWidget {
  const PortalEquipmentPage({super.key});

  @override
  ConsumerState<PortalEquipmentPage> createState() =>
      _PortalEquipmentPageState();
}

class _PortalEquipmentPageState extends ConsumerState<PortalEquipmentPage> {
  final _busca = TextEditingController();

  @override
  void dispose() {
    _busca.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final equipamentos = ref.watch(portalAssetsProvider);
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(portalAssetsProvider);
        await ref.read(portalAssetsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.md,
          OrbitSpacing.gutter,
          OrbitSpacing.xl,
        ),
        children: [
          TextField(
            controller: _busca,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Buscar equipamento',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: ListenableBuilder(
                listenable: _busca,
                builder: (context, _) => _busca.text.isEmpty
                    ? const SizedBox.shrink()
                    : IconButton(
                        tooltip: 'Limpar busca',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _busca.clear();
                          ref.read(portalAssetSearchProvider.notifier).state =
                              '';
                        },
                      ),
              ),
            ),
            onSubmitted: (texto) =>
                ref.read(portalAssetSearchProvider.notifier).state = texto,
          ),
          const SizedBox(height: OrbitSpacing.md),
          equipamentos.when(
            loading: () => const SectionLoading(lines: 5),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(portalAssetsProvider),
            ),
            data: (page) => page.items.isEmpty
                ? SectionEmpty(
                    icon: Icons.ac_unit,
                    message: ref.read(portalAssetSearchProvider).isEmpty
                        ? 'Nenhum equipamento cadastrado para você ainda.'
                        : 'Nenhum equipamento encontrado com essa busca.',
                  )
                : PortalCardList(
                    children: [
                      for (final equipamento in page.items)
                        PortalAssetCard(
                          asset: equipamento,
                          onTap: () =>
                              showPortalAssetSheet(context, equipamento),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

/// Relatórios, PMOC, orçamentos e recibos — tudo o que foi emitido para o
/// cliente, com o filtro que separa o que ele procura.
class PortalDocumentsPage extends ConsumerWidget {
  const PortalDocumentsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categoria = ref.watch(portalDocumentCategoryProvider);
    final documentos = ref.watch(portalDocumentsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(portalDocumentsProvider);
        await ref.read(portalDocumentsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.md,
          OrbitSpacing.gutter,
          OrbitSpacing.xl,
        ),
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _Filtro(
                  rotulo: 'Todos',
                  ativo: categoria == null,
                  onTap: () =>
                      ref.read(portalDocumentCategoryProvider.notifier).state =
                          null,
                ),
                for (final opcao in PortalDocumentCategory.values)
                  _Filtro(
                    rotulo: opcao.label,
                    ativo: categoria == opcao,
                    onTap: () =>
                        ref
                                .read(portalDocumentCategoryProvider.notifier)
                                .state =
                            opcao,
                  ),
              ],
            ),
          ),
          const SizedBox(height: OrbitSpacing.md),
          documentos.when(
            loading: () => const SectionLoading(lines: 5),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(portalDocumentsProvider),
            ),
            data: (page) => page.items.isEmpty
                ? SectionEmpty(
                    icon: Icons.description_outlined,
                    message: categoria == null
                        ? 'Nenhum documento emitido ainda. Relatórios, recibos e orçamentos aparecem aqui assim que forem emitidos.'
                        : 'Nenhum documento em ${categoria.label}.',
                  )
                : PortalCardList(
                    children: [
                      for (final documento in page.items)
                        PortalDocumentRow(document: documento),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _Filtro extends StatelessWidget {
  const _Filtro({
    required this.rotulo,
    required this.ativo,
    required this.onTap,
  });

  final String rotulo;
  final bool ativo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: OrbitSpacing.sm),
    child: ChoiceChip(
      label: Text(rotulo),
      selected: ativo,
      onSelected: (_) => onTap(),
    ),
  );
}

/// O convite para abrir um chamado, logo no Início.
class _AjudaCard extends StatelessWidget {
  const _AjudaCard({required this.onAbrir});

  final VoidCallback onAbrir;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return PortalCard(
      onTap: onAbrir,
      child: Row(
        children: [
          const PortalIconTile(icon: Icons.support_agent),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Precisa de ajuda?',
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                Text(
                  'Abra um chamado: manutenção, problema num equipamento ou uma dúvida.',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: palette.accent),
        ],
      ),
    );
  }
}
