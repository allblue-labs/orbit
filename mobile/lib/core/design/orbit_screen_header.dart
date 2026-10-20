/// As peças do topo de uma tela de lista.
///
/// ## Por que existem, e por que aqui
///
/// Atendimentos, Clientes e Documentos abrem do mesmo jeito: título grande,
/// contagem do resultado, busca, recortes. A terceira cópia do mesmo `Row` foi
/// a que mostrou o problema — as três tinham o **mesmo defeito**, e corrigir
/// numa só teria deixado as outras duas quebradas de um jeito que ninguém
/// notaria até um cliente reclamar.
///
/// ## Os dois defeitos que estas peças resolvem
///
/// Aparecem juntos em tela estreita com texto ampliado (320 px, 1.5×), que é
/// exatamente a combinação de quem tem dificuldade de enxergar:
///
/// ```text
/// "Atendime        o título quebrava no meio da palavra, porque a contagem
///  ntos"            ao lado comia a largura que ele precisava
///
/// "Em andament|▣"  o último recorte era cortado rente ao botão de filtro,
///                   sem nenhum sinal de que a faixa rola
/// ```
library;

import 'package:flutter/material.dart';

import '../theme/orbit_theme.dart';

/// O título da tela e a contagem do resultado.
///
/// A contagem desce para a linha de baixo quando as duas não cabem lado a
/// lado. É a única saída que não estraga nada: encolher o título com
/// `FittedBox` deixaria a tela com tipografia diferente de todas as outras, e
/// cortar com reticências transformaria "Atendimentos" em "Atendiment…".
class OrbitScreenHeading extends StatelessWidget {
  const OrbitScreenHeading({super.key, required this.title, this.count});

  final String title;

  /// Já formatada — "6 documentos", "1 cliente". Quem chama sabe o plural.
  final String? count;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final estiloTitulo = OrbitType.screenTitle.copyWith(
      color: palette.ink,
      fontSize: 24,
    );
    final estiloContagem = OrbitType.caption.copyWith(color: palette.inkSubtle);

    final titulo = Text(title, style: estiloTitulo);
    if (count == null) {
      return Align(alignment: Alignment.centerLeft, child: titulo);
    }
    final contagem = Text(count!, style: estiloContagem);

    return LayoutBuilder(
      builder: (context, constraints) {
        final escala = MediaQuery.textScalerOf(context);
        final larguraTitulo = _largura(title, estiloTitulo, escala);
        final larguraContagem = _largura(count!, estiloContagem, escala);
        final cabem =
            larguraTitulo + OrbitSpacing.md + larguraContagem <=
            constraints.maxWidth;

        if (cabem) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Expanded(child: titulo),
              const SizedBox(width: OrbitSpacing.md),
              contagem,
            ],
          );
        }

        /// Último recurso: o título sozinho já não cabe na linha.
        ///
        /// Acontece em 320 px com texto 2.0×, e aí a escolha é entre
        /// encolher e quebrar a palavra. "Documento/s" é pior que um título
        /// um pouco menor — uma palavra partida se lê errado antes de se
        /// ler certo.
        final coube = larguraTitulo <= constraints.maxWidth;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (coube)
              titulo
            else
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: titulo,
              ),
            const SizedBox(height: 2),
            contagem,
          ],
        );
      },
    );
  }

  static double _largura(String texto, TextStyle estilo, TextScaler escala) {
    final pintor = TextPainter(
      text: TextSpan(text: texto, style: estilo),
      textDirection: TextDirection.ltr,
      textScaler: escala,
      maxLines: 1,
    )..layout();
    final largura = pintor.width;
    pintor.dispose();
    return largura;
  }
}

/// A faixa horizontal de recortes, com um botão fixo à direita.
///
/// ## O esmaecido da borda
///
/// Sem ele, o chip cortado rente ao botão parece defeito de layout, não faixa
/// que rola. Aparece **só quando há o que rolar**: um esmaecido permanente
/// apagaria de graça o último recorte de quem tem tela larga.
class OrbitChipStrip extends StatefulWidget {
  const OrbitChipStrip({
    super.key,
    required this.children,
    this.trailing,
    this.height = 38,
  });

  final List<Widget> children;

  /// Fica parado à direita — o botão de filtros, normalmente.
  final Widget? trailing;
  final double height;

  @override
  State<OrbitChipStrip> createState() => _OrbitChipStripState();
}

class _OrbitChipStripState extends State<OrbitChipStrip> {
  final _scroll = ScrollController();
  bool _temMais = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_recalcular);
    WidgetsBinding.instance.addPostFrameCallback((_) => _recalcular());
  }

  @override
  void didUpdateWidget(OrbitChipStrip anterior) {
    super.didUpdateWidget(anterior);
    WidgetsBinding.instance.addPostFrameCallback((_) => _recalcular());
  }

  @override
  void dispose() {
    _scroll.removeListener(_recalcular);
    _scroll.dispose();
    super.dispose();
  }

  void _recalcular() {
    if (!mounted || !_scroll.hasClients) return;
    final posicao = _scroll.position;
    final falta = posicao.maxScrollExtent - posicao.pixels > 1;
    if (falta != _temMais) setState(() => _temMais = falta);
  }

  @override
  Widget build(BuildContext context) {
    final lista = ListView(
      controller: _scroll,
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.only(
        left: OrbitSpacing.gutter,
        right: OrbitSpacing.sm,
      ),
      children: widget.children,
    );

    return SizedBox(
      /// A altura acompanha a ampliação do texto.
      ///
      /// Fixa em 38, o chip era cortado ao meio em 2.0× — "Todos" aparecia
      /// pela metade, o que parece defeito de renderização.
      height:
          widget.height *
          MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.8),
      child: Row(
        children: [
          Expanded(
            child: _temMais
                ? ShaderMask(
                    shaderCallback: (rect) => const LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [Colors.black, Colors.black, Colors.transparent],
                      stops: [0, 0.88, 1],
                    ).createShader(rect),
                    blendMode: BlendMode.dstIn,
                    child: lista,
                  )
                : lista,
          ),
          if (widget.trailing case final botao?)
            Padding(
              padding: const EdgeInsets.only(right: OrbitSpacing.gutter),
              child: botao,
            ),
        ],
      ),
    );
  }
}
