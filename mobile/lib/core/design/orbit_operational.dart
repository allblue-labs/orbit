import 'package:flutter/material.dart';
import '../theme/orbit_theme.dart';

/// Shared visual projection: callers retain ordering, labels and authority.
class OrbitServiceRow extends StatelessWidget {
  const OrbitServiceRow({
    super.key,
    required this.title,
    this.time,
    this.subtitle,
    this.detail,
    this.status,
    this.icon,
    this.onTap,
    this.accent,
    this.timeline = false,
    this.emphasis = false,
  });
  final String title;
  final String? time, subtitle, detail;
  final Widget? status;
  final IconData? icon;
  final VoidCallback? onTap;
  final Color? accent;
  final bool timeline, emphasis;

  @override
  Widget build(BuildContext context) {
    final p = context.orbit;
    final color = accent ?? p.inkMuted;
    final scale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 2.0);
    return Material(
      color: emphasis ? p.surfaceMuted : p.surface,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (time != null) ...[
                SizedBox(
                  width: 48 * scale,
                  child: Column(
                    children: [
                      Text(
                        time!,
                        style: OrbitType.numeric.copyWith(color: p.ink),
                      ),
                      const SizedBox(height: 8),
                      if (timeline) ...[
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                          ),
                        ),
                        Container(width: 1, height: 28, color: p.border),
                      ] else if (icon != null)
                        Icon(icon, size: 18, color: color),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
              ] else if (icon != null) ...[
                Container(
                  width: 40,
                  height: 46,
                  decoration: BoxDecoration(
                    color: p.surfaceMuted,
                    borderRadius: OrbitRadius.field,
                  ),
                  child: Icon(icon, size: 23, color: color),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: OrbitType.itemTitle.copyWith(color: p.ink),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        subtitle!,
                        style: OrbitType.caption.copyWith(color: p.inkMuted),
                      ),
                    ],
                    if (detail != null || status != null) ...[
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (detail != null)
                            Text(
                              detail!,
                              style: OrbitType.label.copyWith(
                                fontWeight: FontWeight.w400,
                                color: p.inkSubtle,
                              ),
                            ),
                          if (status != null) status!,
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null) ...[
                const SizedBox(width: 4),
                Icon(Icons.chevron_right, size: 18, color: p.inkSubtle),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// O endereço dá para desenhar?
///
/// `http` **e** `https`, ambos com host. A condição era só `https`, e em
/// desenvolvimento a API atende em `http`: a foto chegava gravada e o widget
/// caía nas iniciais, sem dizer nada. Recusar a imagem enquanto o aplicativo
/// conversa com a mesma API pelo mesmo transporte não protege de nada — só
/// esconde o que foi salvo.
///
/// O que continua barrado é o que não é endereço de rede: relativo, `data:`,
/// vazio. Para esses a inicial é a resposta certa, e um `Image.network` só
/// produziria um erro silencioso.
bool desenhavelComoImagemDeRede(Uri? uri) =>
    uri != null &&
    (uri.isScheme('http') || uri.isScheme('https')) &&
    uri.host.isNotEmpty;

class OrbitAvatar extends StatelessWidget {
  const OrbitAvatar({
    super.key,
    required this.initials,
    this.url,
    this.size = 40,
  });
  final String initials;
  final String? url;
  final double size;
  @override
  Widget build(BuildContext context) {
    final p = context.orbit;
    final uri = Uri.tryParse(url ?? '');
    final fallback = Center(
      child: Text(initials, style: OrbitType.label.copyWith(color: p.inkMuted)),
    );
    return ExcludeSemantics(
      child: ClipOval(
        child: Container(
          width: size,
          height: size,
          color: p.surfaceSunken,
          /// `http` também desenha.
          ///
          /// A condição era `scheme == 'https'`, e em desenvolvimento a API
          /// atende em `http`: a foto chegava gravada e o widget caía nas
          /// iniciais, sem dizer nada. Recusar a imagem enquanto o aplicativo
          /// conversa com a mesma API pelo mesmo transporte não protege de
          /// nada — só esconde o que foi salvo.
          ///
          /// O que continua barrado é o que não é endereço de rede: relativo,
          /// `data:`, vazio. Para esses a inicial é a resposta certa, e um
          /// `Image.network` só produziria um erro silencioso.
          child: desenhavelComoImagemDeRede(uri)
              ? Image.network(
                  uri!.toString(),
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => fallback,
                )
              : fallback,
        ),
      ),
    );
  }
}

/// Labels remain available to assistive technology and long-press tooltips.
class OrbitBottomNav extends StatelessWidget {
  const OrbitBottomNav({
    super.key,
    required this.items,
    required this.selected,
    required this.onSelect,
  });

  /// `label` é o que a barra desenha; `fullLabel`, o que o leitor de tela
  /// anuncia e o tooltip mostra. São diferentes de propósito: "Atend." cabe
  /// em 78 pixels, e quem ouve a tela precisa de "Atendimentos".
  final List<
    ({String label, String fullLabel, IconData icon, IconData selectedIcon})
  >
  items;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final p = context.orbit;
    return Material(
      color: p.surface,
      child: SafeArea(
        top: false,
        child: Container(
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: p.border)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Row(
            children: [
              for (var i = 0; i < items.length; i++)
                Expanded(
                  child: Semantics(
                    label: items[i].fullLabel,
                    selected: selected == i,
                    button: true,
                    onTap: () => onSelect(i),
                    excludeSemantics: true,
                    child: Tooltip(
                      message: items[i].fullLabel,
                      child: InkWell(
                        borderRadius: OrbitRadius.field,
                        onTap: () => onSelect(i),
                        child: SizedBox(
                          /// Altura fixa, em qualquer escala de texto.
                          ///
                          /// O ícone não acompanha o `textScaler` e o rótulo
                          /// para de crescer em 1.2×, então 56 pixels sempre
                          /// bastam — e uma barra que muda de altura conforme
                          /// a preferência de texto empurra o conteúdo da
                          /// tela para cima sem motivo.
                          height: 56,
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                selected == i
                                    ? items[i].selectedIcon
                                    : items[i].icon,
                                size: 22,
                                color: selected == i ? p.accent : p.inkSubtle,
                              ),
                              const SizedBox(height: 3),

                              /// O rótulo, não um ponto.
                              ///
                              /// O ponto dizia qual aba estava ativa e nada
                              /// mais — quem não reconhece o ícone continuava
                              /// sem saber para onde ia. O nome resolve as
                              /// duas coisas, e a cor continua marcando a
                              /// seleção.
                              ///
                              /// ## Por que a ampliação para em 1.2×
                              ///
                              /// Em 320 pixels com texto 2.0×, cinco rótulos
                              /// viravam "Início Ate… Cli… Docs Perfil"
                              /// encostados uns nos outros — ilegíveis
                              /// justamente para quem ampliou o texto para
                              /// conseguir ler. O limite é o que barra de
                              /// abas faz em toda parte, e **não** apaga
                              /// acessibilidade: o ícone cresce, o toque tem
                              /// 56 pixels de altura, e o leitor de tela
                              /// continua recebendo o nome inteiro.
                              MediaQuery.withClampedTextScaling(
                                maxScaleFactor: 1.2,
                                child: Text(
                                  items[i].label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: TextAlign.center,
                                  style: OrbitType.label.copyWith(
                                    fontSize: 11,
                                    color: selected == i
                                        ? p.accent
                                        : p.inkSubtle,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
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
