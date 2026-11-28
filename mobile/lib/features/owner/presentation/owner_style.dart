/// O vocabulário visual da Área do proprietário.
///
/// O mesmo desenho da área do cliente — cartões com ícone do que o item é,
/// estado num selo, fichas com rótulo em cima e valor embaixo —, ajustado a
/// quem administra: listas mais densas, o valor em destaque quando há dinheiro
/// e as ações perigosas separadas das do dia a dia.
library;

import 'package:flutter/material.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';

/// O tom de um status pelo código que o servidor publica.
OrbitTone ownerStatusTone(Object? status) => switch (status) {
  'COMPLETED' || 'ACTIVE' || 'CONFIRMED' || 'READY' => OrbitTone.success,
  'IN_PROGRESS' || 'SCHEDULED' || 'OPEN' => OrbitTone.info,
  'PAUSED' ||
  'PENDING' ||
  'NOT_STARTED' ||
  'PROSPECT' ||
  'RENDERING' => OrbitTone.warning,
  'CANCELLED' || 'BLOCKED' || 'SUSPENDED' || 'FAILED' => OrbitTone.danger,
  _ => OrbitTone.neutral,
};

/// Fundo e tinta de um tom.
(Color, Color) ownerToneColors(BuildContext context, OrbitTone tone) {
  final p = context.orbit;
  return switch (tone) {
    OrbitTone.success => (p.successSoft, p.success),
    OrbitTone.warning => (p.warningSoft, p.warning),
    OrbitTone.danger => (p.dangerSoft, p.danger),
    OrbitTone.intelligence => (p.intelligenceSoft, p.intelligence),
    OrbitTone.info => (p.accentSoft, p.accentStrong),
    OrbitTone.neutral => (p.surfaceMuted, p.inkMuted),
  };
}

/// Um selo de estado: rótulo e tom.
typedef OwnerBadgeData = ({String label, OrbitTone tone});

/// A superfície de todo item da área.
class OwnerSurface extends StatelessWidget {
  const OwnerSurface({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(OrbitSpacing.md),
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: OrbitRadius.card,
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// O quadrado com o ícone do que o item é.
class OwnerIconTile extends StatelessWidget {
  const OwnerIconTile({
    super.key,
    required this.icon,
    this.tone = OrbitTone.info,
    this.size = 44,
  });

  final IconData icon;
  final OrbitTone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final (fundo, tinta) = ownerToneColors(context, tone);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: fundo, borderRadius: OrbitRadius.field),
      child: Icon(icon, color: tinta, size: size * .5),
    );
  }
}

/// Um item de lista: o que é, o nome, os detalhes, o estado e o valor.
class OwnerItemCard extends StatelessWidget {
  const OwnerItemCard({
    super.key,
    required this.icon,
    required this.title,
    this.tone = OrbitTone.info,
    this.meta,
    this.badge,
    this.amount,
    this.onTap,
  });

  final IconData icon;
  final OrbitTone tone;
  final String title;
  final String? meta;
  final OwnerBadgeData? badge;
  final String? amount;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final valor = amount;
    return OwnerSurface(
      onTap: onTap,
      padding: const EdgeInsets.all(OrbitSpacing.ms),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OwnerIconTile(icon: icon, tone: tone),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title.isEmpty ? 'Sem nome' : title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                if (meta case final texto? when texto.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    texto,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: OrbitType.caption.copyWith(color: palette.inkMuted),
                  ),
                ],
                if (badge case final selo?) ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  OrbitStatusBadge(label: selo.label, tone: selo.tone),
                ],
              ],
            ),
          ),
          if (valor != null && valor.isNotEmpty) ...[
            const SizedBox(width: OrbitSpacing.sm),
            Text(
              valor,
              style: OrbitType.itemTitle.copyWith(
                color: palette.ink,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ] else if (onTap != null)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.ms),
              child: Icon(
                Icons.chevron_right_rounded,
                color: palette.inkSubtle,
              ),
            ),
        ],
      ),
    );
  }
}

/// O cabeçalho das fichas: o tipo, o nome, um complemento e o estado.
class OwnerSheetHeader extends StatelessWidget {
  const OwnerSheetHeader({
    super.key,
    required this.title,
    this.icon = Icons.article_outlined,
    this.tone = OrbitTone.info,
    this.eyebrow,
    this.subtitle,
    this.badge,
  });

  final IconData icon;
  final OrbitTone tone;
  final String? eyebrow;
  final String title;
  final String? subtitle;
  final OwnerBadgeData? badge;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OwnerIconTile(icon: icon, tone: tone, size: 48),
        const SizedBox(width: OrbitSpacing.ms),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (eyebrow case final rotulo? when rotulo.isNotEmpty) ...[
                Text(
                  rotulo.toUpperCase(),
                  style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
                ),
                const SizedBox(height: 2),
              ],
              Text(
                title,
                style: OrbitType.sectionTitle.copyWith(color: palette.ink),
              ),
              if (subtitle case final texto? when texto.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  texto,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
              ],
              if (badge case final selo?) ...[
                const SizedBox(height: OrbitSpacing.sm),
                OrbitStatusBadge(label: selo.label, tone: selo.tone),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Os dados de uma ficha, um por linha: rótulo em cima, valor embaixo.
///
/// Empilhado, e não em duas colunas: numa tela de 320 pixels a coluna de
/// rótulos espremia o valor.
class OwnerFactsCard extends StatelessWidget {
  const OwnerFactsCard({super.key, required this.facts});

  /// Sem valor, a linha não aparece.
  final List<(String, String?)> facts;

  static List<(String, String)> visible(List<(String, String?)> facts) => [
    for (final (rotulo, valor) in facts)
      if (valor != null && valor.trim().isNotEmpty) (rotulo, valor.trim()),
  ];

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final linhas = visible(facts);
    if (linhas.isEmpty) return const SizedBox.shrink();
    return OwnerSurface(
      padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (indice, (rotulo, valor)) in linhas.indexed) ...[
            if (indice > 0) Divider(height: 1, color: palette.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.ms),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rotulo,
                    style: OrbitType.caption.copyWith(color: palette.inkMuted),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    valor,
                    style: OrbitType.body.copyWith(color: palette.ink),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Uma lista de linhas tocáveis num cartão só — as ações de uma ficha, as
/// entradas do menu.
class OwnerTileGroup extends StatelessWidget {
  const OwnerTileGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return OwnerSurface(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (indice, filho) in children.indexed) ...[
            if (indice > 0)
              Divider(
                height: 1,
                indent: OrbitSpacing.md + 36 + OrbitSpacing.ms,
                color: palette.border,
              ),
            filho,
          ],
        ],
      ),
    );
  }
}

/// Uma linha de [OwnerTileGroup]: ícone, rótulo, descrição e seta.
class OwnerTile extends StatelessWidget {
  const OwnerTile({
    super.key,
    required this.icon,
    required this.label,
    this.description,
    this.tone = OrbitTone.info,
    this.danger = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String? description;
  final OrbitTone tone;
  final bool danger;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final cor = danger ? palette.danger : palette.ink;
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.md,
            vertical: OrbitSpacing.ms,
          ),
          child: Row(
            children: [
              OwnerIconTile(
                icon: icon,
                tone: danger ? OrbitTone.danger : tone,
                size: 36,
              ),
              const SizedBox(width: OrbitSpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: OrbitType.body.copyWith(color: cor)),
                    if (description case final texto?
                        when texto.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        texto,
                        style: OrbitType.caption.copyWith(
                          color: palette.inkMuted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null)
                Icon(
                  Icons.chevron_right_rounded,
                  color: danger ? palette.danger : palette.inkSubtle,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// O título pequeno acima de um grupo.
class OwnerGroupLabel extends StatelessWidget {
  const OwnerGroupLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(
      left: OrbitSpacing.xs,
      bottom: OrbitSpacing.sm,
    ),
    child: Text(
      text.toUpperCase(),
      style: OrbitType.eyebrow.copyWith(color: context.orbit.inkSubtle),
    ),
  );
}

/// Um aviso discreto: "nada aqui, e por quê".
class OwnerNote extends StatelessWidget {
  const OwnerNote({
    super.key,
    required this.text,
    this.icon = Icons.info_outline,
    this.tone,
  });

  final IconData icon;
  final String text;

  /// Com tom, o aviso pede atenção (um erro, um alerta).
  final OrbitTone? tone;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final (fundo, tinta) = tone == null
        ? (palette.surfaceMuted, palette.inkMuted)
        : ownerToneColors(context, tone!);
    return Container(
      padding: const EdgeInsets.all(OrbitSpacing.ms),
      decoration: BoxDecoration(color: fundo, borderRadius: OrbitRadius.card),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: tinta, size: 20),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Text(text, style: OrbitType.caption.copyWith(color: tinta)),
          ),
        ],
      ),
    );
  }
}

/// Uma linha de resumo: rótulo à esquerda, valor à direita.
class OwnerSummaryLine extends StatelessWidget {
  const OwnerSummaryLine(
    this.label,
    this.value, {
    super.key,
    this.strong = false,
  });

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final estilo = strong
        ? OrbitType.itemTitle.copyWith(color: palette.ink)
        : OrbitType.body.copyWith(color: palette.inkMuted);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: estilo)),
          const SizedBox(width: OrbitSpacing.sm),
          Text(
            value,
            style: estilo.copyWith(
              color: palette.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
