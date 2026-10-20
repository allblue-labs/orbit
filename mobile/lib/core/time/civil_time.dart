/// Data civil e instante — duas coisas que o app não pode confundir.
///
/// ## O problema
///
/// "Hoje" não é uma pergunta que o aparelho saiba responder. O técnico trabalha
/// no fuso da **unidade de negócio**; o telefone pode estar em roaming, com o
/// relógio em UTC, ou simplesmente errado. Se a tela decidir o dia civil com
/// `DateTime.now()`, dois aparelhos lado a lado podem pedir dias diferentes ao
/// backend — e um deles verá a agenda errada.
///
/// ## A distinção
///
/// ```text
/// instante   → um ponto no tempo. Vem em ISO com fuso; exibir no fuso local
///              do aparelho é correto, porque é o mesmo ponto para todos.
/// data civil → um dia no calendário de alguém. `2026-09-01` não é um
///              instante: só significa algo dentro de um fuso.
/// ```
///
/// Instante formata-se com o relógio de quem lê. Data civil **não se
/// reinterpreta**: chega pronta do backend e é exibida como veio.
library;

/// Um dia no calendário, sem hora e sem fuso.
///
/// Existe para tornar impossível o erro que o tipo `DateTime` convida a
/// cometer: somar horas a uma data civil, convertê-la para UTC, ou compará-la
/// com um instante. Nada disso faz sentido aqui, e nada disso compila.
class CivilDate implements Comparable<CivilDate> {
  const CivilDate(this.year, this.month, this.day);

  final int year;
  final int month;
  final int day;

  /// Lê `YYYY-MM-DD` — o formato que o backend usa para data civil.
  static CivilDate? tryParse(String? value) {
    if (value == null || value.length < 10) return null;
    final year = int.tryParse(value.substring(0, 4));
    final month = int.tryParse(value.substring(5, 7));
    final day = int.tryParse(value.substring(8, 10));
    if (year == null || month == null || day == null) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return CivilDate(year, month, day);
  }

  /// O formato que o backend espera de volta.
  String toIsoString() =>
      '${year.toString().padLeft(4, '0')}-'
      '${month.toString().padLeft(2, '0')}-'
      '${day.toString().padLeft(2, '0')}';

  /// Avança ou recua dias no calendário.
  ///
  /// Usa `DateTime` em UTC apenas como calculadora de calendário — nunca como
  /// instante. Em UTC não há horário de verão, então somar 24 horas sempre
  /// avança exatamente um dia.
  CivilDate addDays(int days) {
    final moved = DateTime.utc(year, month, day).add(Duration(days: days));
    return CivilDate(moved.year, moved.month, moved.day);
  }

  @override
  int compareTo(CivilDate other) {
    if (year != other.year) return year.compareTo(other.year);
    if (month != other.month) return month.compareTo(other.month);
    return day.compareTo(other.day);
  }

  @override
  bool operator ==(Object other) =>
      other is CivilDate &&
      other.year == year &&
      other.month == month &&
      other.day == day;

  @override
  int get hashCode => Object.hash(year, month, day);

  @override
  String toString() => toIsoString();
}

/// De onde vem "hoje".
///
/// O app não pergunta ao aparelho: pergunta a este relógio, que resolve o dia
/// no fuso informado. Injetável para que o teste possa provar o comportamento
/// com o aparelho em qualquer fuso — inclusive um que troque o dia.
class OrbitClock {
  const OrbitClock({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;

  /// O instante atual. Para marcar quando algo aconteceu.
  DateTime instant() => _now();

  /// O dia civil corrente no fuso indicado.
  ///
  /// `offset` é a diferença do fuso em relação a UTC — normalmente a da
  /// unidade de negócio, publicada pelo backend. Sem ela, a única resposta
  /// honesta seria "não sei", e é por isso que o parâmetro não tem padrão
  /// silencioso: quem chama precisa dizer de quem é o calendário.
  CivilDate today({required Duration offset}) {
    final local = _now().toUtc().add(offset);
    return CivilDate(local.year, local.month, local.day);
  }
}
