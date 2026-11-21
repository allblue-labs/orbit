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
import 'portal_widgets.dart';

Future<void> showPortalOperationSheet(BuildContext context, String id) =>
    _sheet(context, (_) => _OperationSheet(operationId: id));

Future<void> showPortalAssetSheet(BuildContext context, PortalAsset asset) =>
    _sheet(context, (_) => _AssetSheet(asset: asset));

/// O fundo da ficha é o da tela, e não branco: os blocos dentro dela são
/// cartões, e cartão branco sobre branco some.
Future<void> _sheet(BuildContext context, WidgetBuilder builder) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: context.orbit.background,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (context, controller) => PrimaryScrollController(
          controller: controller,
          child: builder(context),
        ),
      ),
    );

const _respiro = EdgeInsets.fromLTRB(
  OrbitSpacing.gutter,
  0,
  OrbitSpacing.gutter,
  OrbitSpacing.xl,
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
    final tom = operationTone(operation.status.code);
    return ListView(
      controller: PrimaryScrollController.of(context),
      padding: _respiro,
      children: [
        PortalSheetHeader(
          icon: Icons.build_circle_outlined,
          tone: tom,
          eyebrow: '${operation.type} · ${operation.code}',
          title: operation.title,
          badge: OrbitStatusBadge(label: operation.status.label, tone: tom),
        ),
        const PortalBlockTitle('Atendimento'),
        PortalFactsCard(
          facts: [
            (
              'Agendado para',
              operation.scheduledStart == null
                  ? null
                  : portalDateTime(operation.scheduledStart),
            ),
            (
              'Iniciado em',
              operation.startedAt == null
                  ? null
                  : portalDateTime(operation.startedAt),
            ),
            (
              'Concluído em',
              operation.completedAt == null
                  ? null
                  : portalDateTime(operation.completedAt),
            ),
            ('Técnico responsável', operation.technician),
            ('Unidade', operation.unitName),
            ('Local', operation.location),
            (
              'Equipamentos',
              operation.assets.map((asset) => asset.name).join('\n'),
            ),
          ],
        ),
        if (operation.description case final String descricao) ...[
          const PortalBlockTitle('O que foi feito'),
          PortalCard(
            child: Text(
              descricao,
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
          ),
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
              ? PortalNote(
                  icon: Icons.hourglass_empty,
                  text: operation.status.code == 'completed'
                      ? 'O documento deste atendimento ainda está sendo emitido.'
                      : 'O documento fica disponível quando o atendimento for concluído.',
                )
              : PortalCardList(
                  children: [
                    for (final documento in page.items)
                      PortalDocumentRow(document: documento),
                  ],
                ),
        ),
        if (operation.timeline.isNotEmpty) ...[
          const PortalBlockTitle('Linha do tempo'),
          PortalTimeline(events: operation.timeline),
        ],
      ],
    );
  }
}

class _AssetSheet extends ConsumerWidget {
  const _AssetSheet({required this.asset});

  /// O que a lista já sabe: a ficha abre na hora, e o detalhe completa.
  final PortalAsset asset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final completo = ref.watch(portalAssetProvider(asset.id)).valueOrNull;
    final atual = completo ?? asset;
    final historico = ref.watch(portalAssetHistoryProvider(asset.id));
    final documentos = ref.watch(portalAssetDocumentsProvider(asset.id));
    final tom = assetTone(atual.status.code);

    return ListView(
      controller: PrimaryScrollController.of(context),
      padding: _respiro,
      children: [
        PortalSheetHeader(
          icon: Icons.ac_unit,
          tone: OrbitTone.info,
          eyebrow: atual.category,
          title: atual.name,
          badge: OrbitStatusBadge(label: atual.status.label, tone: tom),
        ),
        const PortalBlockTitle('Ficha do equipamento'),
        PortalFactsCard(
          facts: [
            ('Fabricante e modelo', atual.makeAndModel),
            ('Número de série', atual.serialNumber),
            ('Identificação', atual.identifier),
            ('Local', atual.location),
            ('Instalado em', _dia(atual.installedOn)),
            ('Garantia até', _dia(atual.warrantyUntil)),
          ],
        ),
        const PortalBlockTitle('Histórico de atendimentos'),
        historico.when(
          loading: () => const SectionLoading(lines: 2),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () => ref.invalidate(portalAssetHistoryProvider(asset.id)),
          ),
          data: (page) => page.items.isEmpty
              ? const PortalNote(
                  icon: Icons.event_note_outlined,
                  text: 'Nenhum atendimento registrado para este equipamento.',
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
        const PortalBlockTitle('Documentos'),
        documentos.when(
          loading: () => const SectionLoading(lines: 1),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () =>
                ref.invalidate(portalAssetDocumentsProvider(asset.id)),
          ),
          data: (page) => page.items.isEmpty
              ? const PortalNote(
                  icon: Icons.description_outlined,
                  text: 'Nenhum documento emitido para este equipamento.',
                )
              : PortalCardList(
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
