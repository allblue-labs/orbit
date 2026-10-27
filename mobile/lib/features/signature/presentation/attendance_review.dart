/// Apresentação do resumo publicado pelo servidor. Cada linha permanece visível;
/// a divisão em seções não altera o texto, a versão ou o hash do aceite.
library;

import 'package:flutter/material.dart';
import '../../../core/contracts/mobile_signature_contracts.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';

class AttendanceReview extends StatelessWidget {
  const AttendanceReview({super.key, required this.preparation});
  final CustomerAcknowledgementPreparation preparation;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final groups = reviewGroups(preparation.serviceSummary);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                palette.accent.withValues(alpha: .12),
                palette.accent.withValues(alpha: .03),
              ],
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.fact_check_outlined, color: palette.accent, size: 32),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Confira antes de confirmar',
                      style: OrbitType.sectionTitle.copyWith(
                        color: palette.ink,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Revise o serviço com quem recebeu o atendimento. Depois, informe o nome e colete a assinatura.',
                      style: OrbitType.body.copyWith(color: palette.inkMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            Icon(Icons.person_outline, size: 20, color: palette.inkMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                preparation.customerName ?? 'Cliente do atendimento',
                style: OrbitType.body.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
        if (preparation.performedAt != null)
          Padding(
            padding: const EdgeInsets.only(left: 30, top: 6),
            child: Row(
              children: [
                Icon(Icons.schedule, size: 14, color: palette.inkMuted),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    OrbitFormat.dateHourOf(preparation.performedAt),
                    style: OrbitType.caption.copyWith(color: palette.inkMuted),
                  ),
                ),
              ],
            ),
          ),
        if (preparation.equipment.isNotEmpty) ...[
          const SizedBox(height: 24),
          _ReviewHeading(
            icon: Icons.devices_other_outlined,
            title: 'Equipamentos atendidos',
            count: preparation.equipment.length,
          ),
          const SizedBox(height: 10),
          for (final item in preparation.equipment)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.settings_outlined,
                    size: 18,
                    color: palette.inkMuted,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: OrbitType.body),
                        if (item.code.isNotEmpty && item.code != item.id)
                          Text(
                            item.code,
                            style: OrbitType.caption.copyWith(
                              color: palette.inkMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
        for (final group in groups) ...[
          const SizedBox(height: 18),
          const Divider(height: 1),
          const SizedBox(height: 18),
          _ReviewHeading(icon: group.icon, title: group.title),
          const SizedBox(height: 12),
          for (final line in group.lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ReviewLine(text: line),
            ),
        ],
        const SizedBox(height: 16),
      ],
    );
  }
}

class ReviewGroup {
  ReviewGroup(this.title, this.icon, this.lines);
  final String title;
  final IconData icon;
  final List<String> lines;
}

/// Somente formatação: não completa respostas, não oculta linhas e não decide
/// o que foi feito. Prefixos desconhecidos permanecem no resumo do serviço.
List<ReviewGroup> reviewGroups(String summary) {
  final groups = <ReviewGroup>[];
  var current = ReviewGroup('Serviço realizado', Icons.handyman_outlined, []);
  groups.add(current);
  for (final line in summary.split('\n')) {
    if (line.trim().isEmpty) continue;
    IconData? icon;
    if (line.startsWith('Checklist:')) icon = Icons.checklist_rounded;
    if (line.startsWith('Materiais utilizados:')) {
      icon = Icons.inventory_2_outlined;
    }
    if (line.startsWith('Evidências registradas:')) {
      icon = Icons.photo_library_outlined;
    }
    if (line.startsWith('Serviço realizado:')) {
      icon = Icons.description_outlined;
    }
    if (icon != null) {
      current = ReviewGroup(line, icon, []);
      groups.add(current);
    } else {
      current.lines.add(line);
    }
  }
  return groups
      .where(
        (group) => group.lines.isNotEmpty || group.title != 'Serviço realizado',
      )
      .toList(growable: false);
}

class _ReviewHeading extends StatelessWidget {
  const _ReviewHeading({required this.icon, required this.title, this.count});
  final IconData icon;
  final String title;
  final int? count;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, color: context.orbit.accent, size: 21),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          title,
          style: OrbitType.body.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
      if (count != null)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
          decoration: BoxDecoration(
            color: context.orbit.accent.withValues(alpha: .08),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            '$count',
            style: OrbitType.caption.copyWith(color: context.orbit.accent),
          ),
        ),
    ],
  );
}

class _ReviewLine extends StatelessWidget {
  const _ReviewLine({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) {
    final done = text.endsWith(': Realizado');
    final undone = text.endsWith(': Não realizado');
    final icon = done
        ? Icons.check_circle_outline
        : undone
        ? Icons.remove_circle_outline
        : Icons.chevron_right_rounded;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 18,
          color: done
              ? context.orbit.success
              : undone
              ? context.orbit.warning
              : context.orbit.inkMuted,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(text, style: OrbitType.body.copyWith(height: 1.45)),
        ),
      ],
    );
  }
}
