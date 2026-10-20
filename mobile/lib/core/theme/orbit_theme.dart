/// Tema do Orbit Operator.
///
/// ## O que mudou, e por quê
///
/// O tema anterior era azul-marinho com gradiente azul–roxo: bonito numa
/// apresentação, ruim numa laje ao meio-dia. Uma ferramenta de campo é lida em
/// pé, com luva, sob sol, entre uma tarefa e outra — o que ela precisa é
/// contraste alto, hierarquia clara e nenhuma decoração competindo com a
/// informação.
///
/// Agora o fundo é **branco**, o texto é quase preto, e a cor existe para
/// significar alguma coisa: azul é ação, verde é concluído, âmbar é atenção,
/// vermelho é problema. Nada é colorido por enfeite.
///
/// ## Pronto para o escuro, sem o escuro
///
/// Só o claro é implementado nesta rodada. Mas nenhuma tela conhece
/// `Colors.white` ou `Colors.blue`: elas pedem `OrbitPalette`, que é uma
/// `ThemeExtension`. Trocar a paleta é acrescentar um segundo objeto e ligá-lo
/// em `darkTheme` — nenhum widget muda.
library;

import 'package:flutter/material.dart';

/// Os tons crus. **Nenhuma tela usa este arquivo diretamente**: as telas leem
/// `OrbitPalette`, que é o que troca no dia do tema escuro.
abstract final class _Tokens {
  /// Superfícies.
  ///
  /// White pages; neutral surfaces only group information when necessary.
  static const white = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF7F8FA);
  static const surfaceSunken = Color(0xFFEEF0F3);
  static const border = Color(0x1F171F30);
  static const borderStrong = Color(0x29171F30);

  /// Tinta. Navy da marca, não cinza neutro.
  static const ink = Color(0xFF171F30);
  static const inkMuted = Color(0xFF3F4A5F);
  static const inkSubtle = Color(0xFF5A6474);
  static const inkDisabled = Color(0xFF98A1B2);

  /// Azul orbital — a cor de ação do produto.
  static const brand = Color(0xFF156CDD);
  static const brandHover = Color(0xFF0F55B0);
  static const brandSoft = Color(0xFFEAF1FD);

  /// Status. Os mesmos tons do produto web.
  static const success = Color(0xFF08784F);
  static const successSoft = Color(0xFFE6F6F0);
  static const warning = Color(0xFF8A5D00);
  static const warningSoft = Color(0xFFFDF4E3);
  static const danger = Color(0xFFC32635);
  static const dangerSoft = Color(0xFFFCEBEC);

  /// Violeta da marca — reservado à camada de inteligência.
  static const intelligence = Color(0xFF7962DD);
  static const intelligenceSoft = Color(0xFFF1EEFC);
}

/// As sombras.
///
/// Premium não vem de sombra forte, vem de sombra **em camadas**: uma quase
/// invisível colada no objeto, que dá a borda, e outra larga e difusa, que dá
/// a distância do fundo. Sombra única e escura é o que faz interface parecer
/// de 2014.
abstract final class OrbitShadow {
  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x0A171F30), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(
      color: Color(0x0F171F30),
      blurRadius: 16,
      offset: Offset(0, 6),
      spreadRadius: -4,
    ),
  ];

  static const List<BoxShadow> raised = [
    BoxShadow(color: Color(0x0D171F30), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(
      color: Color(0x1A171F30),
      blurRadius: 28,
      offset: Offset(0, 12),
      spreadRadius: -8,
    ),
  ];

  /// Para o cartão de destaque, que é azul: a sombra herda a cor da marca.
  static const List<BoxShadow> brand = [
    BoxShadow(
      color: Color(0x33156CDD),
      blurRadius: 24,
      offset: Offset(0, 10),
      spreadRadius: -6,
    ),
  ];
}

/// A paleta semântica que as telas consomem.
///
/// Os nomes dizem o **papel**, não o tom: `surface`, `ink`, `accent`,
/// `success`. É o que permite trocar todos os valores de uma vez sem procurar
/// cor solta em cinquenta widgets.
@immutable
class OrbitPalette extends ThemeExtension<OrbitPalette> {
  const OrbitPalette({
    required this.background,
    required this.surface,
    required this.surfaceMuted,
    required this.surfaceSunken,
    required this.border,
    required this.borderStrong,
    required this.ink,
    required this.inkMuted,
    required this.inkSubtle,
    required this.inkDisabled,
    required this.accent,
    required this.accentStrong,
    required this.accentSoft,
    required this.success,
    required this.successSoft,
    required this.warning,
    required this.warningSoft,
    required this.danger,
    required this.dangerSoft,
    required this.intelligence,
    required this.intelligenceSoft,
  });

  final Color background;
  final Color surface;
  final Color surfaceMuted;
  final Color surfaceSunken;
  final Color border;
  final Color borderStrong;
  final Color ink;
  final Color inkMuted;
  final Color inkSubtle;
  final Color inkDisabled;
  final Color accent;
  final Color accentStrong;
  final Color accentSoft;
  final Color success;
  final Color successSoft;
  final Color warning;
  final Color warningSoft;
  final Color danger;
  final Color dangerSoft;
  final Color intelligence;
  final Color intelligenceSoft;

  static const light = OrbitPalette(
    /// O fundo da página **não** é branco.
    ///
    /// Cartão branco sobre página branca não é cartão: a única coisa que os
    /// separa é a sombra, e ela é fraca de propósito. Um fundo levemente frio
    /// é o que faz a camada existir — e é o que faltava para a lista deixar de
    /// parecer colada na barra de filtros.
    background: _Tokens.surfaceMuted,
    surface: _Tokens.white,
    surfaceMuted: _Tokens.surfaceMuted,
    surfaceSunken: _Tokens.surfaceSunken,
    border: _Tokens.border,
    borderStrong: _Tokens.borderStrong,
    ink: _Tokens.ink,
    inkMuted: _Tokens.inkMuted,
    inkSubtle: _Tokens.inkSubtle,
    inkDisabled: _Tokens.inkDisabled,
    accent: _Tokens.brand,
    accentStrong: _Tokens.brandHover,
    accentSoft: _Tokens.brandSoft,
    success: _Tokens.success,
    successSoft: _Tokens.successSoft,
    warning: _Tokens.warning,
    warningSoft: _Tokens.warningSoft,
    danger: _Tokens.danger,
    dangerSoft: _Tokens.dangerSoft,
    intelligence: _Tokens.intelligence,
    intelligenceSoft: _Tokens.intelligenceSoft,
  );

  @override
  OrbitPalette copyWith({
    Color? background,
    Color? surface,
    Color? surfaceMuted,
    Color? surfaceSunken,
    Color? border,
    Color? borderStrong,
    Color? ink,
    Color? inkMuted,
    Color? inkSubtle,
    Color? inkDisabled,
    Color? accent,
    Color? accentStrong,
    Color? accentSoft,
    Color? success,
    Color? successSoft,
    Color? warning,
    Color? warningSoft,
    Color? danger,
    Color? dangerSoft,
    Color? intelligence,
    Color? intelligenceSoft,
  }) {
    return OrbitPalette(
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceMuted: surfaceMuted ?? this.surfaceMuted,
      surfaceSunken: surfaceSunken ?? this.surfaceSunken,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      ink: ink ?? this.ink,
      inkMuted: inkMuted ?? this.inkMuted,
      inkSubtle: inkSubtle ?? this.inkSubtle,
      inkDisabled: inkDisabled ?? this.inkDisabled,
      accent: accent ?? this.accent,
      accentStrong: accentStrong ?? this.accentStrong,
      accentSoft: accentSoft ?? this.accentSoft,
      success: success ?? this.success,
      successSoft: successSoft ?? this.successSoft,
      warning: warning ?? this.warning,
      warningSoft: warningSoft ?? this.warningSoft,
      danger: danger ?? this.danger,
      dangerSoft: dangerSoft ?? this.dangerSoft,
      intelligence: intelligence ?? this.intelligence,
      intelligenceSoft: intelligenceSoft ?? this.intelligenceSoft,
    );
  }

  @override
  OrbitPalette lerp(OrbitPalette? other, double t) {
    if (other == null) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t) ?? a;
    return OrbitPalette(
      background: mix(background, other.background),
      surface: mix(surface, other.surface),
      surfaceMuted: mix(surfaceMuted, other.surfaceMuted),
      surfaceSunken: mix(surfaceSunken, other.surfaceSunken),
      border: mix(border, other.border),
      borderStrong: mix(borderStrong, other.borderStrong),
      ink: mix(ink, other.ink),
      inkMuted: mix(inkMuted, other.inkMuted),
      inkSubtle: mix(inkSubtle, other.inkSubtle),
      inkDisabled: mix(inkDisabled, other.inkDisabled),
      accent: mix(accent, other.accent),
      accentStrong: mix(accentStrong, other.accentStrong),
      accentSoft: mix(accentSoft, other.accentSoft),
      success: mix(success, other.success),
      successSoft: mix(successSoft, other.successSoft),
      warning: mix(warning, other.warning),
      warningSoft: mix(warningSoft, other.warningSoft),
      danger: mix(danger, other.danger),
      dangerSoft: mix(dangerSoft, other.dangerSoft),
      intelligence: mix(intelligence, other.intelligence),
      intelligenceSoft: mix(intelligenceSoft, other.intelligenceSoft),
    );
  }
}

/// Os nomes semânticos que as telas já usavam, agora apontando para o claro.
///
/// O vocabulário anterior já era quase todo de papel — `textSecondary`,
/// `warning`, `danger`, `success` —, e só os tons (`deepSky`, `brandBright`)
/// eram nome de cor. Repontá-lo é o que faz as trinta e três telas existentes
/// nascerem no tema branco sem trinta e três edições, e é a costura por onde a
/// migração continua: quem toca numa tela passa a usar `context.orbit`.
///
/// **Nada aqui é constante de tom.** Todos os valores vêm de `OrbitPalette`,
/// que é o objeto que troca no dia do tema escuro.
abstract final class OrbitColors {
  static const textPrimary = _Tokens.ink;
  static const textSecondary = _Tokens.inkMuted;
  static const border = _Tokens.border;
  static const surface = _Tokens.surfaceMuted;

  /// Azul de ação. Usado em botão, link, seleção — nunca como área grande.
  static const brand = _Tokens.brand;

  /// Antes era um azul mais claro para brilhar no escuro. No branco, o que
  /// destaca é o tom mais forte: contraste vem do escuro sobre claro.
  static const brandBright = _Tokens.brandHover;

  static const success = _Tokens.success;
  static const warning = _Tokens.warning;
  static const danger = _Tokens.danger;

  /// Roxo, e **somente** para a camada de inteligência.
  static const intelligence = _Tokens.intelligence;
}

/// Acesso curto à paleta: `context.orbit.accent`.
extension OrbitPaletteAccess on BuildContext {
  OrbitPalette get orbit =>
      Theme.of(this).extension<OrbitPalette>() ?? OrbitPalette.light;
}

/// Raios.
///
/// Maiores que a versão anterior, de propósito: a direção é espaçosa, e canto
/// suave é metade do que faz um cartão parecer objeto em vez de retângulo.
abstract final class OrbitRadius {
  static const hero = BorderRadius.all(Radius.circular(12));
  static const card = BorderRadius.all(Radius.circular(12));
  static const field = BorderRadius.all(Radius.circular(10));
  static const chip = BorderRadius.all(Radius.circular(10));
  static const pill = BorderRadius.all(Radius.circular(999));
}

/// A escala de espaço. Múltiplos de quatro, e só estes.
///
/// Ganhou três degraus no topo (`xl2`, `xl3`) porque a direção espaçosa precisa
/// de respiro de verdade entre blocos — 32 era o teto e virava o padrão.
abstract final class OrbitSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const ms = 12.0;
  static const md = 16.0;
  static const ml = 20.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xl2 = 40.0;
  static const xl3 = 48.0;

  /// A margem lateral da tela. Um valor, em todo lugar.
  static const screenHorizontalPadding = 16.0;
  static const gutter = screenHorizontalPadding;
}

/// As duas famílias da marca.
///
/// A mesma dupla do produto web: Space Grotesk carrega título e número — tem
/// personalidade e largura para isso —, e Inter carrega tudo que se lê em
/// quantidade. Ambas empacotadas; declarar sem empacotar faz o iOS cair calado
/// na fonte do sistema e o aplicativo deixa de parecer o produto.
abstract final class OrbitFont {
  static const display = 'SpaceGrotesk';
  static const text = 'Inter';
}

/// A hierarquia tipográfica.
///
/// Cada papel tem um trabalho. Os que precisam de presença — título de tela,
/// número de métrica, destaque — usam a display; o resto usa Inter, que é
/// desenhada para ser lida em corpo pequeno.
abstract final class OrbitType {
  /// O número de uma métrica. Grande, tabular, com a display.
  static const metric = TextStyle(
    fontFamily: OrbitFont.display,
    fontSize: 24,
    fontWeight: FontWeight.w700,
    height: 1.05,
    letterSpacing: -0.8,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  static const heroTitle = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 17,
    fontWeight: FontWeight.w600,
    height: 1.18,
    letterSpacing: -0.5,
  );

  static const screenTitle = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 21,
    fontWeight: FontWeight.w600,
    height: 1.15,
    letterSpacing: -0.6,
  );

  /// Rótulo de seção. Não é mais caixa alta espremida: é uma frase legível,
  /// com peso, do tamanho de um subtítulo.
  static const sectionTitle = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 16,
    fontWeight: FontWeight.w600,
    height: 1.25,
    letterSpacing: -0.2,
  );

  static const itemTitle = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.3,
    letterSpacing: -0.1,
  );

  static const body = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 14,
    height: 1.45,
  );

  static const caption = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 13,
    height: 1.4,
  );

  /// Sobrancelha: o rótulo pequeno em caixa alta acima de um bloco.
  static const eyebrow = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 11,
    fontWeight: FontWeight.w600,
    height: 1.2,
    letterSpacing: 0.8,
  );

  static const label = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
  );

  /// Horário e contagem em linha: tabular, para alinhar em coluna.
  static const numeric = TextStyle(
    fontFamily: OrbitFont.text,
    fontSize: 14,
    fontWeight: FontWeight.w600,
    fontFeatures: [FontFeature.tabularFigures()],
    letterSpacing: -0.1,
  );
}

abstract final class OrbitTheme {
  /// O tema claro — o único desta rodada.
  static ThemeData light() {
    const palette = OrbitPalette.light;

    const scheme = ColorScheme.light(
      primary: _Tokens.brand,
      onPrimary: _Tokens.white,

      /// Secundária também azul: roxo é reservado à inteligência.
      secondary: _Tokens.brandHover,
      onSecondary: _Tokens.white,
      surface: _Tokens.white,
      onSurface: _Tokens.ink,
      surfaceContainerHighest: _Tokens.surfaceMuted,
      error: _Tokens.danger,
      onError: _Tokens.white,
      outline: _Tokens.border,
      outlineVariant: _Tokens.borderStrong,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: palette.background,
      fontFamily: OrbitFont.text,
    );

    return base.copyWith(
      extensions: const [palette],

      /// Transparente: a barra assenta sobre o fundo da página em vez de
      /// desenhar uma faixa branca que corta a tela em duas.
      appBarTheme: AppBarTheme(
        backgroundColor: palette.background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: _Tokens.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: OrbitType.sectionTitle.copyWith(
          color: _Tokens.ink,
          fontSize: 21,
          fontWeight: FontWeight.w600,
        ),
      ),

      /// Borda leve em vez de sombra: elevação empilhada vira ruído numa lista.
      cardTheme: const CardThemeData(
        color: _Tokens.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: OrbitRadius.card,
          side: BorderSide(color: _Tokens.border),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: _Tokens.white,
        border: OutlineInputBorder(
          borderRadius: OrbitRadius.field,
          borderSide: BorderSide(color: _Tokens.borderStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: OrbitRadius.field,
          borderSide: BorderSide(color: _Tokens.borderStrong),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: OrbitRadius.field,
          borderSide: BorderSide(color: _Tokens.brand, width: 1.6),
        ),
        labelStyle: TextStyle(color: _Tokens.inkMuted),
        hintStyle: TextStyle(color: _Tokens.inkDisabled),
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      ),

      /// 52 e 48: alvos confortáveis para quem trabalha de luva.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: const RoundedRectangleBorder(borderRadius: OrbitRadius.field),
          textStyle: OrbitType.label.copyWith(fontSize: 14),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          foregroundColor: _Tokens.ink,
          side: const BorderSide(color: _Tokens.borderStrong),
          shape: const RoundedRectangleBorder(borderRadius: OrbitRadius.field),
          textStyle: OrbitType.label.copyWith(fontSize: 14),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: _Tokens.brand,
          minimumSize: const Size(0, 44),
          textStyle: OrbitType.label.copyWith(fontSize: 14),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: _Tokens.white,
        indicatorColor: _Tokens.brandSoft,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => OrbitType.label.copyWith(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? _Tokens.brand
                : _Tokens.inkSubtle,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 22,
            color: states.contains(WidgetState.selected)
                ? _Tokens.brand
                : _Tokens.inkSubtle,
          ),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: _Tokens.border,
        space: 1,
        thickness: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: _Tokens.white,
        selectedColor: _Tokens.brandSoft,
        side: const BorderSide(color: _Tokens.border),
        shape: const RoundedRectangleBorder(borderRadius: OrbitRadius.pill),

        /// Cor explícita nos dois estados. Sem ela o rótulo do chip não
        /// selecionado herda um tom que some contra o fundo branco — o chip
        /// vira uma pílula vazia.
        labelStyle: OrbitType.label.copyWith(
          fontSize: 13,
          color: _Tokens.inkMuted,
        ),
        secondaryLabelStyle: OrbitType.label.copyWith(
          fontSize: 13,
          color: _Tokens.brandHover,
        ),
        showCheckmark: false,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: _Tokens.inkSubtle,
        textColor: _Tokens.ink,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: _Tokens.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
      dialogTheme: const DialogThemeData(
        backgroundColor: _Tokens.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: OrbitRadius.card),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: _Tokens.ink,
        contentTextStyle: TextStyle(color: _Tokens.white, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: OrbitRadius.field),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: _Tokens.brand,
        linearTrackColor: _Tokens.surfaceSunken,
      ),
      textTheme: base.textTheme.apply(
        bodyColor: _Tokens.ink,
        displayColor: _Tokens.ink,
      ),
    );
  }
}
