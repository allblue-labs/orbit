/// A lista de ajustes, no formato que todo mundo já sabe usar.
///
/// ## Por que copiar o padrão do sistema
///
/// A tela de Perfil é a única do aplicativo que não é sobre o trabalho: é
/// sobre o aplicativo. Aqui a originalidade não rende nada — quem abre
/// procura um interruptor ou um caminho, e reconhece a forma antes de ler o
/// rótulo. Grupos com título, linhas de altura constante, ícone à esquerda,
/// valor e seta à direita.
///
/// ## O que um grupo é
///
/// Um cartão com cantos arredondados e filetes **entre** as linhas, nunca
/// antes da primeira nem depois da última — filete na borda de um cartão
/// desenha uma segunda borda e suja o contorno.
library;

import 'package:flutter/material.dart';

import '../theme/orbit_theme.dart';

/// Um grupo de ajustes.
class OrbitSettingsGroup extends StatelessWidget {
  const OrbitSettingsGroup({super.key, required this.children, this.title});

  /// Em versalete acima do cartão, como no sistema. Opcional: um grupo só na
  /// tela não precisa de nome.
  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    if (children.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title case final String rotulo)
          Padding(
            padding: const EdgeInsets.only(
              left: OrbitSpacing.xs,
              bottom: OrbitSpacing.sm,
            ),
            child: Text(
              rotulo.toUpperCase(),
              style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
            ),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: palette.surface,
            borderRadius: OrbitRadius.card,
            boxShadow: OrbitShadow.card,
          ),
          child: ClipRRect(
            borderRadius: OrbitRadius.card,
            child: Column(
              children: [
                for (final (posicao, linha) in children.indexed) ...[
                  if (posicao > 0)
                    /// Recuado até onde o texto começa, como no sistema: o
                    /// filete separa rótulos, não corta o cartão ao meio.
                    Padding(
                      padding: const EdgeInsets.only(left: 56),
                      child: Divider(
                        height: 1,
                        thickness: 1,
                        color: palette.border,
                      ),
                    ),
                  linha,
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Uma linha de ajuste.
///
/// Três formas, e a diferença é o que fica à direita: um caminho (seta), um
/// valor (texto) ou um interruptor. [trailing] cobre o resto.
class OrbitSettingsRow extends StatelessWidget {
  const OrbitSettingsRow({
    super.key,
    required this.icon,
    required this.label,
    this.description,
    this.value,
    this.trailing,
    this.onTap,
    this.tone,
    this.iconColor,
  });

  final IconData icon;
  final String label;

  /// A linha de baixo. Use para o que precisa de explicação, não para repetir
  /// o rótulo com outras palavras.
  final String? description;

  /// O valor atual, à direita. Ignorado quando há [trailing].
  final String? value;

  final Widget? trailing;
  final VoidCallback? onTap;

  /// Tinge rótulo e ícone. Para a linha destrutiva — sair da conta.
  final Color? tone;

  /// Tinge só o ícone. Para estado: a sincronização em ordem é verde.
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final cor = tone ?? palette.ink;

    /// Acima de 1.3× o valor desce para baixo do rótulo: lado a lado, sobra
    /// largura demais de menos para os dois e ambos ficam cortados.
    final empilhado = MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final valor = value == null
        ? null
        : Text(
            value!,
            style: OrbitType.body.copyWith(color: palette.inkMuted),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: empilhado ? TextAlign.start : TextAlign.end,
          );

    final seta = onTap != null && trailing == null
        ? Icon(Icons.chevron_right_rounded, size: 20, color: palette.inkSubtle)
        : null;

    /// Com o texto ampliado, o controle desce para baixo do texto.
    ///
    /// Um interruptor à direita ocupa largura fixa, e em 320 px com texto
    /// 2.0× sobrava tão pouco para o rótulo que "Novo atendimento" quebrava
    /// em "Novo aten/dimento". É o que o próprio sistema faz nos tamanhos de
    /// acessibilidade: o controle sai da linha, não o texto.
    if (empilhado) {
      return Material(
        color: palette.surface,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.md,
              vertical: OrbitSpacing.ms,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, size: 20, color: iconColor ?? cor),
                    const SizedBox(width: OrbitSpacing.ms),
                    Expanded(
                      child: Text(
                        label,
                        style: OrbitType.body.copyWith(color: cor),
                      ),
                    ),
                    if (seta case final Widget fim) fim,
                  ],
                ),
                if (description case final String texto) ...[
                  const SizedBox(height: 2),
                  Text(
                    texto,
                    style: OrbitType.caption.copyWith(color: palette.inkSubtle),
                  ),
                ],
                if (valor != null) ...[const SizedBox(height: 2), valor],
                if (trailing case final Widget controle) ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  Align(alignment: Alignment.centerLeft, child: controle),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return Material(
      color: palette.surface,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.md,
            vertical: OrbitSpacing.ms,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 28,
                child: Icon(icon, size: 20, color: iconColor ?? cor),
              ),
              const SizedBox(width: OrbitSpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(label, style: OrbitType.body.copyWith(color: cor)),
                    if (description case final String texto) ...[
                      const SizedBox(height: 2),
                      Text(
                        texto,
                        style: OrbitType.caption.copyWith(
                          color: palette.inkSubtle,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (trailing case final Widget fim) ...[
                const SizedBox(width: OrbitSpacing.sm),
                fim,
              ] else if (valor != null) ...[
                const SizedBox(width: OrbitSpacing.sm),
                Flexible(child: valor),
              ],
              if (seta case final Widget fim) ...[
                const SizedBox(width: OrbitSpacing.xs),
                fim,
              ],
            ],
          ),
        ),
      ),
    );
  }
}
