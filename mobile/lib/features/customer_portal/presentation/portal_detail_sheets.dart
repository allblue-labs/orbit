/// As fichas que abrem por cima das páginas: atendimento e equipamento.
///
/// Painéis, e não páginas: a área do cliente tem três páginas, e o detalhe é
/// uma olhada — abre, lê, fecha, e a lista continua onde estava.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/portal_providers.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';

Future<void> showPortalOperationSheet(BuildContext context, String id) =>
    _sheet(context, (_) => _OperationSheet(operationId: id));

Future<void> showPortalAssetSheet(BuildContext context, PortalAsset asset) =>
    _sheet(context, (_) => _AssetSheet(asset: asset));

Future<void> _sheet(BuildContext context, WidgetBuilder builder) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: context.orbit.surface,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (context, controller) => PrimaryScrollController(
          controller: controller,
          child: builder(context),
        ),
      ),
    );

class _OperationSheet extends ConsumerWidget {
  const _OperationSheet({required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detalhe = ref.watch(portalOperationProvider(operationId));
    return detalhe.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(OrbitSpacing.lg),
        child: SectionLoading(lines: 6),
      ),
      error: (error, _) => Padding(
        padding: const EdgeInsets.all(OrbitSpacing.lg),
        child: SectionError(
          error: error,
          onRetry: () => ref.invalidate(portalOperationProvider(operationId)),
        ),
      ),
      data: (operation) => _OperationBody(operation: operation),
    );
  }
}

class _OperationBody extends ConsumerWidget {
  const _OperationBody({required this.operation});

  final PortalOperation operation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final documentos = ref.watch(
      portalOperationDocumentsProvider(operation.id),
    );
    return ListView(
      controller: PrimaryScrollController.of(context),
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      children: [
        Text(
          '${operation.type} · ${operation.code}',
          style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
        ),
        const SizedBox(height: OrbitSpacing.xs),
        Text(
          operation.title,
          style: OrbitType.screenTitle.copyWith(color: palette.ink),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        Align(
          alignment: Alignment.centerLeft,
          child: OrbitStatusBadge(
            label: operation.status.label,
            tone: operationTone(operation.status.code),
          ),
        ),
        const PortalBlockTitle('Atendimento'),
        PortalFact(
          label: 'Agendado para',
          value: operation.scheduledStart == null
              ? null
              : portalDateTime(operation.scheduledStart),
        ),
        PortalFact(
          label: 'Iniciado em',
          value: operation.startedAt == null
              ? null
              : portalDateTime(operation.startedAt),
        ),
        PortalFact(
          label: 'Concluído em',
          value: operation.completedAt == null
              ? null
              : portalDateTime(operation.completedAt),
        ),
        PortalFact(label: 'Técnico', value: operation.technician),
        PortalFact(label: 'Unidade', value: operation.unitName),
        PortalFact(label: 'Local', value: operation.location),
        PortalFact(
          label: 'Equipamentos',
          value: operation.assets.map((asset) => asset.name).join(', '),
        ),
        if (operation.description case final String descricao) ...[
          const PortalBlockTitle('Descrição'),
          Text(descricao, style: OrbitType.body.copyWith(color: palette.ink)),
        ],
        const PortalBlockTitle('Documentos'),
        documentos.when(
          loading: () => const SectionLoading(lines: 1),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () =>
                ref.invalidate(portalOperationDocumentsProvider(operation.id)),
          ),
          data: (page) => page.items.isEmpty
              ? Text(
                  operation.status.code == 'completed'
                      ? 'O documento deste atendimento ainda está sendo emitido.'
                      : 'O documento fica disponível quando o atendimento for concluído.',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                )
              : Column(
                  children: [
                    for (final documento in page.items)
                      PortalDocumentRow(document: documento),
                  ],
                ),
        ),
        if (operation.timeline.isNotEmpty) ...[
          const PortalBlockTitle('Linha do tempo'),
          for (final evento in operation.timeline)
            _TimelineEntry(event: evento),
        ],
      ],
    );
  }
}

class _TimelineEntry extends StatelessWidget {
  const _TimelineEntry({required this.event});

  final PortalTimelineEvent event;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.ms),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: palette.accent,
                shape: BoxShape.circle,
              ),
            ),
          ),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.description.isEmpty ? event.event : event.description,
                  style: OrbitType.body.copyWith(color: palette.ink),
                ),
                Text(
                  portalDateTime(event.occurredAt),
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AssetSheet extends ConsumerWidget {
  const _AssetSheet({required this.asset});

  /// O que a lista já sabe: a ficha abre na hora, e o detalhe completa.
  final PortalAsset asset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final completo = ref.watch(portalAssetProvider(asset.id)).valueOrNull;
    final atual = completo ?? asset;
    final historico = ref.watch(portalAssetHistoryProvider(asset.id));
    final documentos = ref.watch(portalAssetDocumentsProvider(asset.id));

    return ListView(
      controller: PrimaryScrollController.of(context),
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      children: [
        Text(
          atual.category.toUpperCase(),
          style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
        ),
        const SizedBox(height: OrbitSpacing.xs),
        Text(
          atual.name,
          style: OrbitType.screenTitle.copyWith(color: palette.ink),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        Align(
          alignment: Alignment.centerLeft,
          child: OrbitStatusBadge(
            label: atual.status.label,
            tone: assetTone(atual.status.code),
          ),
        ),
        const PortalBlockTitle('Ficha'),
        PortalFact(label: 'Fabricante e modelo', value: atual.makeAndModel),
        PortalFact(label: 'Número de série', value: atual.serialNumber),
        PortalFact(label: 'Identificação', value: atual.identifier),
        PortalFact(label: 'Local', value: atual.location),
        PortalFact(label: 'Instalado em', value: _dia(atual.installedOn)),
        PortalFact(label: 'Garantia até', value: _dia(atual.warrantyUntil)),
        const PortalBlockTitle('Histórico de atendimentos'),
        historico.when(
          loading: () => const SectionLoading(lines: 2),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () => ref.invalidate(portalAssetHistoryProvider(asset.id)),
          ),
          data: (page) => page.items.isEmpty
              ? Text(
                  'Nenhum atendimento registrado para este equipamento.',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                )
              : Column(
                  children: [
                    for (final operacao in page.items)
                      OrbitListRow(
                        leading: portalDay(operacao.when),
                        title: operacao.title,
                        subtitle: operacao.type,
                        trailing: OrbitStatusBadge(
                          label: operacao.status.label,
                          tone: operationTone(operacao.status.code),
                        ),
                        onTap: () =>
                            showPortalOperationSheet(context, operacao.id),
                      ),
                  ],
                ),
        ),
        const PortalBlockTitle('Documentos'),
        documentos.when(
          loading: () => const SectionLoading(lines: 1),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () =>
                ref.invalidate(portalAssetDocumentsProvider(asset.id)),
          ),
          data: (page) => page.items.isEmpty
              ? Text(
                  'Nenhum documento emitido para este equipamento.',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                )
              : Column(
                  children: [
                    for (final documento in page.items)
                      PortalDocumentRow(document: documento),
                  ],
                ),
        ),
      ],
    );
  }

  /// `AAAA-MM-DD` → `DD/MM/AAAA`. Data civil: sem fuso, sem conversão.
  static String? _dia(String? civil) {
    if (civil == null || civil.length < 10) return null;
    final partes = civil.substring(0, 10).split('-');
    return partes.length == 3 ? '${partes[2]}/${partes[1]}/${partes[0]}' : null;
  }
}
