/// Operational primitives: compact rows, semantic groups and restrained color.
library;

import 'package:flutter/material.dart';

import '../theme/orbit_theme.dart';
import 'orbit_operational.dart';

/// O tom semântico de um estado. Cor **significa**; não decora.
enum OrbitTone { neutral, info, success, warning, danger, intelligence }

/// As cores de um tom, resolvidas contra a paleta.
({Color forte, Color suave}) _cores(OrbitPalette p, OrbitTone tone) =>
    switch (tone) {
      OrbitTone.neutral => (forte: p.inkMuted, suave: p.surfaceSunken),
      OrbitTone.info => (forte: p.accent, suave: p.accentSoft),
      OrbitTone.success => (forte: p.success, suave: p.successSoft),
      OrbitTone.warning => (forte: p.warning, suave: p.warningSoft),
      OrbitTone.danger => (forte: p.danger, suave: p.dangerSoft),
      OrbitTone.intelligence => (
        forte: p.intelligence,
        suave: p.intelligenceSoft,
      ),
    };

/// O contêiner. Tudo que é conteúdo mora dentro de um destes.
///
/// [tone] tinge a faixa da esquerda — o jeito de dizer "urgente" sem pintar o
/// cartão inteiro de vermelho, que cansa e rouba a atenção do que importa.
class OrbitCard extends StatelessWidget {
  const OrbitCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(OrbitSpacing.ml),
    this.tone,
    this.onTap,
    this.raised = false,
  });

  final Widget child;
  final EdgeInsets padding;

  /// Quando presente, desenha a faixa de severidade na borda esquerda.
  final OrbitTone? tone;
  final VoidCallback? onTap;

  /// Sombra mais aberta, para o cartão que precisa flutuar sobre os outros.
  final bool raised;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final faixa = tone == null ? null : _cores(palette, tone!).forte;

    final conteudo = Padding(padding: padding, child: child);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        border: Border.all(color: palette.border),
      ),
      child: ClipRRect(
        borderRadius: OrbitRadius.card,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,

            /// A faixa vai numa `Stack`, e não numa `Row` esticada: `Row` com
            /// `stretch` dentro de lista rolável recebe altura infinita e
            /// quebra o layout. A `Stack` mede pelo conteúdo, e a faixa se
            /// estica sobre a altura já resolvida.
            child: faixa == null
                ? conteudo
                : Stack(
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(left: 4),
                        child: conteudo,
                      ),
                      Positioned(
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        child: ColoredBox(color: faixa),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Uma métrica. O número primeiro, o rótulo embaixo.
///
/// O número usa a display em tabular: métricas ficam lado a lado, e dígito de
/// largura variável faz a linha dançar quando o valor muda.
class OrbitMetric extends StatelessWidget {
  const OrbitMetric({
    super.key,
    required this.value,
    required this.label,
    this.tone = OrbitTone.neutral,
    this.onTap,
  });

  final String value;
  final String label;
  final OrbitTone tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final cor = tone == OrbitTone.neutral
        ? palette.ink
        : _cores(palette, tone).forte;

    return Semantics(
      button: onTap != null,
      label: '$label: $value',
      child: OrbitCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(
          horizontal: OrbitSpacing.ms,
          vertical: OrbitSpacing.md,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(value, style: OrbitType.metric.copyWith(color: cor)),
            const SizedBox(height: OrbitSpacing.xs),

            /// Duas linhas: "Atrasados" não cabe em uma coluna de quatro num
            /// aparelho de 360 pixels, e reticências num rótulo de métrica
            /// deixa o número sem significado.
            Text(
              label,
              style: OrbitType.caption.copyWith(
                color: palette.inkSubtle,
                fontSize: 12,
                height: 1.25,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

/// Uma faixa de métricas: **um** cartão, com colunas divididas.
///
/// Quatro cartõezinhos lado a lado não cabem num aparelho de 360 pixels — o
/// rótulo quebra no meio da palavra e o número perde o significado. Um cartão
/// só, com filete entre as colunas, cabe, lê melhor e é o formato que os
/// painéis de produto usam há anos.
class OrbitMetricStrip extends StatelessWidget {
  const OrbitMetricStrip({super.key, required this.metrics});

  final List<OrbitMetricData> metrics;

  @override
  Widget build(BuildContext context) {
    if (metrics.isEmpty) return const SizedBox.shrink();
    final p = context.orbit;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surfaceMuted,
        borderRadius: OrbitRadius.field,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final columns = MediaQuery.textScalerOf(context).scale(1) > 1.2
              ? 2
              : metrics.length;
          return Wrap(
            children: [
              for (final metric in metrics)
                SizedBox(
                  width: constraints.maxWidth / columns,
                  child: _Coluna(metric),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// Os dados de uma métrica. Separado do widget porque a faixa precisa medir
/// as colunas antes de construí-las.
class OrbitMetricData {
  const OrbitMetricData({
    required this.value,
    required this.label,
    this.tone = OrbitTone.neutral,
    this.onTap,
  });

  final String value;
  final String label;
  final OrbitTone tone;
  final VoidCallback? onTap;
}

class _Coluna extends StatelessWidget {
  const _Coluna(this.dados);

  final OrbitMetricData dados;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final cor = dados.tone == OrbitTone.neutral
        ? palette.ink
        : _cores(palette, dados.tone).forte;

    return Semantics(
      button: dados.onTap != null,
      label: '${dados.label}: ${dados.value}',
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: dados.onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.sm,
              vertical: OrbitSpacing.md,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(dados.value, style: OrbitType.metric.copyWith(color: cor)),
                const SizedBox(height: 2),
                Text(
                  dados.label,
                  textAlign: TextAlign.center,
                  style: OrbitType.caption.copyWith(
                    color: palette.inkSubtle,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// O cartão de destaque — o que a pessoa precisa fazer agora.
///
/// É o único elemento da tela pintado com a cor da marca. Um destaque por tela;
/// dois destaques não destacam nada.
class OrbitHeroCard extends StatelessWidget {
  const OrbitHeroCard({
    super.key,
    required this.eyebrow,
    required this.title,
    this.subtitle,
    this.meta,
    this.action,
    this.onTap,
  });

  final String eyebrow;
  final String title;
  final String? subtitle;
  final String? meta;
  final Widget? action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.orbit;
    return OrbitPanel(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.play_circle_outline, size: 16, color: p.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  eyebrow,
                  style: OrbitType.label.copyWith(color: p.accent),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(title, style: OrbitType.heroTitle.copyWith(color: p.ink)),
          if (subtitle != null)
            Text(
              subtitle!,
              style: OrbitType.caption.copyWith(color: p.inkMuted),
            ),
          if (meta != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                meta!,
                style: OrbitType.label.copyWith(
                  color: p.inkSubtle,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
          if (action != null)
            Align(alignment: Alignment.centerRight, child: action!),
        ],
      ),
    );
  }
}

/// Secondary continuation action inside the neutral active-service panel.
class OrbitHeroButton extends StatelessWidget {
  const OrbitHeroButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return TextButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: palette.surface,
        foregroundColor: palette.accentStrong,
        minimumSize: const Size(48, 48),
        shape: const RoundedRectangleBorder(borderRadius: OrbitRadius.field),
        textStyle: OrbitType.label,
      ),

      /// Large text wraps without dropping the action label.
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 19),
            const SizedBox(width: OrbitSpacing.sm),
          ],
          Flexible(child: Text(label, textAlign: TextAlign.center)),
        ],
      ),
    );
  }
}

/// Um título de seção com o conteúdo logo abaixo.
///
/// Unboxed by default; optional grouping does not change the shared gutter.
class OrbitSection extends StatelessWidget {
  const OrbitSection({
    super.key,
    required this.title,
    required this.child,
    this.action,
    this.actionLabel,
    this.count,
    this.boxed = false,
    this.padding = EdgeInsets.zero,
  });

  final String title;
  final Widget child;
  final VoidCallback? action;
  final String? actionLabel;

  /// A contagem do servidor, quando maior que a lista mostrada.
  final int? count;
  final bool boxed;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final heading = Row(
      children: [
        Flexible(
          child: Text(
            title,
            key: const Key('orbit.section.title'),
            style: OrbitType.sectionTitle.copyWith(color: palette.ink),
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: OrbitSpacing.sm),
          _Contagem(count!),
        ],
      ],
    );
    final link = action == null
        ? null
        : TextButton(
            onPressed: action,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.sm),
              minimumSize: const Size(48, 48),
            ),
            child: Text(actionLabel ?? 'Ver tudo'),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(
            left: 0,
            right: 0,
            bottom: OrbitSpacing.ms,
          ),
          child: largeText
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    heading,
                    if (link != null)
                      Align(alignment: Alignment.centerRight, child: link),
                  ],
                )
              : Row(
                  children: [
                    Expanded(child: heading),
                    if (link != null) link,
                  ],
                ),
        ),
        if (boxed) OrbitCard(padding: padding, child: child) else child,
      ],
    );
  }
}

/// A contagem ao lado do título — um selo, não um "· 6" perdido.
class _Contagem extends StatelessWidget {
  const _Contagem(this.valor);

  final int valor;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: palette.surfaceSunken,
        borderRadius: OrbitRadius.pill,
      ),
      child: Text(
        '$valor',
        style: OrbitType.numeric.copyWith(
          fontSize: 12,
          color: palette.inkSubtle,
        ),
      ),
    );
  }
}

/// Uma linha de lista, dentro de um cartão.
class OrbitListRow extends StatelessWidget {
  const OrbitListRow({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.detail,
    this.trailing,
    this.onTap,
    this.emphasis = false,
    this.tone,
  });

  /// O dado de leitura rápida. Horário, na maioria das vezes.
  final String? leading;
  final String title;
  final String? subtitle;
  final String? detail;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool emphasis;

  /// Tinge o horário — o sinal de severidade mais barato que existe.
  final OrbitTone? tone;

  @override
  Widget build(BuildContext context) {
    return OrbitServiceRow(
      time: leading,
      title: title,
      subtitle: subtitle,
      detail: detail,
      status: trailing,
      onTap: onTap,
      emphasis: emphasis,
      timeline: leading != null,
      accent: tone == null ? null : _cores(context.orbit, tone!).forte,
    );
  }
}

/// Um selo de estado.
class OrbitStatusBadge extends StatelessWidget {
  const OrbitStatusBadge({
    super.key,
    required this.label,
    this.tone = OrbitTone.neutral,
  });

  final String label;
  final OrbitTone tone;

  @override
  Widget build(BuildContext context) {
    final c = _cores(context.orbit, tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: c.suave, borderRadius: OrbitRadius.pill),
      child: Text(
        label,
        style: OrbitType.label.copyWith(color: c.forte, fontSize: 12),
      ),
    );
  }
}

/// Compact shortcut; large accessibility text uses a horizontal layout.
class OrbitQuickAction extends StatelessWidget {
  const OrbitQuickAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.tone = OrbitTone.info,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final OrbitTone tone;

  @override
  Widget build(BuildContext context) {
    final p = context.orbit;
    final horizontal = MediaQuery.textScalerOf(context).scale(1) > 1.7;
    final symbol = Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: p.surfaceMuted,
        borderRadius: OrbitRadius.field,
      ),
      child: Icon(icon, size: 24, color: p.inkMuted),
    );
    final caption = Text(
      label,
      textAlign: horizontal ? TextAlign.start : TextAlign.center,
      style: OrbitType.label.copyWith(
        fontWeight: FontWeight.w500,
        color: p.inkMuted,
      ),
    );
    return Semantics(
      button: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        child: Material(
          color: p.surface,
          child: InkWell(
            onTap: onTap,
            borderRadius: OrbitRadius.field,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: horizontal
                  ? Row(
                      children: [
                        symbol,
                        const SizedBox(width: 12),
                        Expanded(child: caption),
                      ],
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [symbol, const SizedBox(height: 6), caption],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Uma caixa com tom. Continua existindo porque as telas a usam pelo nome;
/// hoje é um [OrbitCard] com faixa de severidade.
class OrbitPanel extends StatelessWidget {
  const OrbitPanel({
    super.key,
    required this.child,
    this.tone = OrbitTone.neutral,
    this.padding = const EdgeInsets.all(OrbitSpacing.ml),
  });

  final Widget child;
  final OrbitTone tone;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => OrbitCard(
    padding: padding,
    tone: tone == OrbitTone.neutral ? null : tone,
    child: child,
  );
}

/// Um vazio que orienta em vez de constatar.
class OrbitEmptyState extends StatelessWidget {
  const OrbitEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.description,
    this.action,
  });

  final IconData icon;
  final String title;
  final String? description;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: OrbitSpacing.lg,
        vertical: OrbitSpacing.xl,
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: palette.surfaceMuted,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 28, color: palette.inkDisabled),
          ),
          const SizedBox(height: OrbitSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: OrbitType.itemTitle.copyWith(color: palette.ink),
          ),
          if (description != null) ...[
            const SizedBox(height: OrbitSpacing.xs),
            Text(
              description!,
              textAlign: TextAlign.center,
              style: OrbitType.body.copyWith(color: palette.inkSubtle),
            ),
          ],
          if (action != null) ...[
            const SizedBox(height: OrbitSpacing.ml),
            action!,
          ],
        ],
      ),
    );
  }
}

/// Separador entre linhas de lista, recuado para não cortar a coluna do
/// horário.
class OrbitRowDivider extends StatelessWidget {
  const OrbitRowDivider({super.key, this.indent = OrbitSpacing.ml});

  final double indent;

  @override
  Widget build(BuildContext context) => Divider(
    height: 1,
    indent: indent,
    endIndent: 0,
    color: context.orbit.border,
  );
}
