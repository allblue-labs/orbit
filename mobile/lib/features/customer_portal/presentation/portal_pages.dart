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
          Text(
            'Olá, ${me?.displayName ?? ''}',
            style: OrbitType.screenTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            'Seus equipamentos e atendimentos com ${me?.organizationName ?? 'a sua empresa de climatização'}.',
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.lg),
          resumo.when(
            loading: () => const SectionLoading(lines: 2),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(portalSummaryProvider),
            ),
            data: (dados) => OrbitMetricStrip(
              metrics: [
                OrbitMetricData(
                  value: '${dados.assets}',
                  label: 'Equipamentos',
                  onTap: () => onOpenTab(1),
                ),
                OrbitMetricData(
                  value: '${dados.availableDocuments}',
                  label: 'Documentos',
                  onTap: () => onOpenTab(2),
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
                  : Column(
                      children: [
                        for (final operacao in page.items)
                          _OperationRow(operation: operacao),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OperationRow extends StatelessWidget {
  const _OperationRow({required this.operation});

  final PortalOperation operation;

  @override
  Widget build(BuildContext context) => OrbitListRow(
    leading: portalDay(operation.when),
    title: operation.title,
    subtitle: [
      operation.type,
      if (operation.technician case final String tecnico) tecnico,
    ].join(' · '),
    detail: operation.assets.isEmpty
        ? operation.location
        : operation.assets.map((asset) => asset.name).join(', '),
    trailing: OrbitStatusBadge(
      label: operation.status.label,
      tone: operationTone(operation.status.code),
    ),
    tone: operationTone(operation.status.code),
    onTap: () => showPortalOperationSheet(context, operation.id),
  );
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
            decoration: const InputDecoration(
              hintText: 'Buscar por nome, identificação ou série',
              prefixIcon: Icon(Icons.search),
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
                : Column(
                    children: [
                      for (final equipamento in page.items)
                        OrbitListRow(
                          title: equipamento.name,
                          subtitle:
                              equipamento.makeAndModel ?? equipamento.category,
                          detail: [
                            equipamento.location,
                            equipamento.identifier,
                          ].whereType<String>().join(' · '),
                          trailing: OrbitStatusBadge(
                            label: equipamento.status.label,
                            tone: assetTone(equipamento.status.code),
                          ),
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
                : Column(
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
