/// Workspace da operação.
///
/// Cada seção resolve o próprio estado: uma falha na timeline não impede o
/// detalhe de aparecer, e um 403 em histórico vira "sem acesso" em vez de erro.
///
/// A leitura principal (`GET /operations/:id`) já traz cliente, ativo, equipe,
/// anexos e o resumo dos checklists — essas seções compartilham a mesma
/// consulta em vez de repetir requisições.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/operation_contracts.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/widgets/section_states.dart';
import '../application/operations_providers.dart';
import 'widgets/evidence_section.dart';
import 'widgets/field_actions.dart';
import 'widgets/intelligence_section.dart';
import 'widgets/location_section.dart';
import 'widgets/status_badge.dart';
import '../../../app/providers.dart';

class OperationDetailScreen extends ConsumerWidget {
  const OperationDetailScreen({super.key, required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(operationDetailProvider(operationId));
    final session = ref.watch(sessionProvider);
    const intelligenceCapability = 'ORBIT_INTELLIGENCE';
    final canUseIntelligence =
        session?.hasPermission('ai.executions.read') == true &&
        session?.hasCapability('ai.executions.read') == true &&
        session?.canUseProductFeature(
              intelligenceCapability,
              intelligenceCapability,
            ) ==
            true;

    return Scaffold(
      appBar: AppBar(
        title: Text(detail.valueOrNull?.value.code ?? 'Operação'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            icon: const Icon(Icons.refresh),
            onPressed: () => invalidateOperation(ref, operationId),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => invalidateOperation(ref, operationId),
        child: ListView(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          children: [
            detail.when(
              loading: () => const SectionBlock(
                title: 'Detalhes',
                child: SectionLoading(lines: 4),
              ),
              error: (error, _) => SectionBlock(
                title: 'Detalhes',
                child: SectionError(
                  error: error,
                  onRetry: () =>
                      ref.invalidate(operationDetailProvider(operationId)),
                ),
              ),
              data: (result) => Column(
                children: [
                  if (result.cachedAt != null)
                    StaleDataBanner(cachedAt: result.cachedAt!),
                  _DetailsSection(operation: result.value),
                  const SizedBox(height: OrbitSpacing.md),
                  FieldActionsSection(operation: result.value),
                  const SizedBox(height: OrbitSpacing.md),
                  EvidenceSection(
                    operationId: operationId,
                    attachments: result.value.attachments,
                  ),
                  const SizedBox(height: OrbitSpacing.md),
                  LocationSection(operationId: operationId),
                  const SizedBox(height: OrbitSpacing.md),
                  _RelationsSection(operation: result.value),
                  const SizedBox(height: OrbitSpacing.md),
                  _ScheduleSection(operation: result.value),
                  const SizedBox(height: OrbitSpacing.md),
                  _TeamSection(operation: result.value),
                  const SizedBox(height: OrbitSpacing.md),
                  _AdditionalDataSection(operation: result.value),
                ],
              ),
            ),
            const SizedBox(height: OrbitSpacing.md),
            if (canUseIntelligence) ...[
              IntelligenceSection(operationId: operationId),
              const SizedBox(height: OrbitSpacing.md),
            ],
            _ChecklistsSection(operationId: operationId),
            const SizedBox(height: OrbitSpacing.md),
            _TimelineSection(operationId: operationId),
            const SizedBox(height: OrbitSpacing.md),
            _HistorySection(operationId: operationId),
            const SizedBox(height: OrbitSpacing.xl),
          ],
        ),
      ),
    );
  }
}

class _DetailsSection extends StatelessWidget {
  const _DetailsSection({required this.operation});

  final Operation operation;

  @override
  Widget build(BuildContext context) {
    return SectionBlock(
      title: operation.title,
      subtitle: operation.code,
      trailing: StatusBadge(status: operation.status),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Field(label: 'Tipo', value: OperationKind.label(operation.kind)),
          _Field(
            label: 'Prioridade',
            value: OperationPriority.label(operation.priority),
          ),
          if (operation.businessUnit != null)
            _Field(label: 'Organização', value: operation.businessUnit!.name),
          if (operation.description != null &&
              operation.description!.isNotEmpty) ...[
            const Divider(height: OrbitSpacing.lg),
            Text(
              operation.description!,
              style: const TextStyle(fontSize: 13, height: 1.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _RelationsSection extends StatelessWidget {
  const _RelationsSection({required this.operation});

  final Operation operation;

  @override
  Widget build(BuildContext context) {
    return SectionBlock(
      title: 'Cliente e ativo',
      child: Column(
        children: [
          _Field(
            label: 'Cliente',
            value: operation.customer?.name ?? 'Não vinculado',
          ),
          _Field(
            label: 'Ativo',
            value: operation.asset == null
                ? 'Não vinculado'
                : [
                    operation.asset!.name,
                    if (operation.asset!.detail != null)
                      operation.asset!.detail!,
                  ].join(' · '),
          ),
        ],
      ),
    );
  }
}

class _ScheduleSection extends StatelessWidget {
  const _ScheduleSection({required this.operation});

  final Operation operation;

  @override
  Widget build(BuildContext context) {
    return SectionBlock(
      title: 'Agendamento',
      child: Column(
        children: [
          _Field(
            label: 'Início previsto',
            value: OrbitFormat.of(context).dateHourOf(operation.scheduledStart),
          ),
          _Field(
            label: 'Término previsto',
            value: OrbitFormat.of(context).dateHourOf(operation.scheduledEnd),
          ),
          _Field(
            label: 'Início real',
            value: OrbitFormat.of(context).dateHourOf(operation.startedAt),
          ),
          _Field(
            label: 'Conclusão',
            value: OrbitFormat.of(context).dateHourOf(operation.completedAt),
          ),
        ],
      ),
    );
  }
}

class _TeamSection extends StatelessWidget {
  const _TeamSection({required this.operation});

  final Operation operation;

  @override
  Widget build(BuildContext context) {
    return SectionBlock(
      title: 'Equipe',
      trailing: Text(
        '${operation.assignees.length}',
        style: const TextStyle(color: OrbitColors.textSecondary),
      ),
      child: operation.assignees.isEmpty
          ? const SectionEmpty(
              icon: Icons.person_outline,
              message: 'Nenhum técnico atribuído.',
            )
          : Column(
              children: [
                for (final assignee in operation.assignees)
                  Padding(
                    padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 16,
                          backgroundColor: OrbitColors.brand.withValues(
                            alpha: 0.2,
                          ),
                          child: Text(
                            _initials(assignee.displayName),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        const SizedBox(width: OrbitSpacing.sm),
                        Expanded(
                          child: Text(
                            assignee.displayName,
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

/// Campos livres devolvidos pelo backend (`location` e `data`).
///
/// Ambos são JSON sem esquema: o app mostra o que o tenant gravou, sem
/// interpretar.
class _AdditionalDataSection extends StatelessWidget {
  const _AdditionalDataSection({required this.operation});

  final Operation operation;

  static bool _hasContent(Map<String, dynamic>? value) =>
      value != null && value.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final hasLocation = _hasContent(operation.location);
    final hasData = _hasContent(operation.data);

    return SectionBlock(
      title: 'Informações adicionais',
      child: !hasLocation && !hasData
          ? const SectionEmpty(message: 'Nenhuma informação adicional.')
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (hasLocation)
                  _JsonBlock(label: 'Local', value: operation.location!),
                if (hasData) _JsonBlock(label: 'Dados', value: operation.data!),
              ],
            ),
    );
  }
}

class _JsonBlock extends StatelessWidget {
  const _JsonBlock({required this.label, required this.value});

  final String label;
  final Map<String, dynamic> value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 10,
              letterSpacing: 1.1,
              color: OrbitColors.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          for (final entry in value.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 120,
                    child: Text(
                      entry.key,
                      style: const TextStyle(
                        fontSize: 12,
                        color: OrbitColors.textSecondary,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      '${entry.value}',
                      style: const TextStyle(fontSize: 12),
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

class _ChecklistsSection extends ConsumerWidget {
  const _ChecklistsSection({required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final checklists = ref.watch(operationChecklistsProvider(operationId));

    return SectionBlock(
      title: 'Checklists',
      child: checklists.when(
        loading: () => const SectionLoading(lines: 2),
        error: (error, _) => SectionError(
          error: error,
          onRetry: () =>
              ref.invalidate(operationChecklistsProvider(operationId)),
        ),
        data: (page) => page.isEmpty
            ? const SectionEmpty(
                icon: Icons.checklist_rtl,
                message: 'Nenhum checklist iniciado para esta operação.',
              )
            : Column(
                children: [
                  for (final checklist in page.data)
                    Padding(
                      padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  checklist.templateName ?? 'Checklist',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                              Text(
                                '${checklist.progress}%',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: OrbitColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: OrbitSpacing.xs),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: checklist.progress / 100,
                              minHeight: 6,
                              backgroundColor: OrbitColors.surface,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _TimelineSection extends ConsumerWidget {
  const _TimelineSection({required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final timeline = ref.watch(operationTimelineProvider(operationId));

    return SectionBlock(
      title: 'Linha do tempo',
      child: timeline.when(
        loading: () => const SectionLoading(),
        error: (error, _) => SectionError(
          error: error,
          onRetry: () => ref.invalidate(operationTimelineProvider(operationId)),
        ),
        data: (data) => data.events.isEmpty
            ? const SectionEmpty(message: 'Nenhum evento registrado.')
            : Column(
                children: [
                  for (final event in data.events.take(12))
                    _TimelineRow(entry: event),
                ],
              ),
      ),
    );
  }
}

class _HistorySection extends ConsumerWidget {
  const _HistorySection({required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(operationHistoryProvider(operationId));

    return SectionBlock(
      title: 'Histórico',
      subtitle: 'Registro de auditoria',
      child: history.when(
        loading: () => const SectionLoading(lines: 2),
        error: (error, _) => SectionError(
          error: error,
          onRetry: () => ref.invalidate(operationHistoryProvider(operationId)),
        ),
        data: (entries) => entries.isEmpty
            ? const SectionEmpty(message: 'Nenhuma alteração registrada.')
            : Column(
                children: [
                  for (final entry in entries.take(10))
                    _TimelineRow(entry: entry),
                ],
              ),
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.entry});

  final OperationHistoryEntry entry;

  @override
  Widget build(BuildContext context) {
    final at = entry.createdAt == null
        ? null
        : OrbitFormat.of(context).at(entry.createdAt!);
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 5),
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: OrbitColors.brand,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.label, style: const TextStyle(fontSize: 13)),
                if (entry.explanation case final explanation?)
                  Padding(
                    padding: const EdgeInsets.only(top: 4, bottom: 4),
                    child: Text(
                      explanation,
                      style: const TextStyle(
                        fontSize: 12,
                        color: OrbitColors.textSecondary,
                      ),
                    ),
                  ),
                Text(
                  [
                    entry.actorName ?? 'Sistema',
                    if (at != null)
                      '${at.day.toString().padLeft(2, '0')}/'
                          '${at.month.toString().padLeft(2, '0')} '
                          '${at.hour.toString().padLeft(2, '0')}:'
                          '${at.minute.toString().padLeft(2, '0')}',
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 11,
                    color: OrbitColors.textSecondary,
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

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: OrbitColors.textSecondary,
              ),
            ),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }
}
