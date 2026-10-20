/// Formatação em português — um lugar só.
///
/// Antes desta PR cada tela montava a sua: `padLeft` para horas, um array de
/// meses aqui, outro ali. O resultado é o de sempre — o mesmo dado aparecendo
/// de três formas, e a correção de uma delas não alcançando as outras.
///
/// ## Instante e data civil não se formatam igual
///
/// Um **instante** (`DateTime`) é o mesmo ponto no tempo para todo mundo;
/// exibi-lo no relógio de quem lê está certo, e é o que `hourOf` faz.
///
/// Uma **data civil** ([CivilDate]) é um dia no calendário de alguém. Ela chega
/// decidida pelo backend, no fuso da unidade, e aqui só vira texto. Não há
/// função que converta uma na outra — de propósito: essa conversão é
/// exatamente o erro que separa "hoje" de "ontem" para quem está viajando.
library;

import 'package:intl/intl.dart';

import '../time/civil_time.dart';

abstract final class OrbitFormat {
  static final _dayMonth = DateFormat("dd 'de' MMM", 'pt_BR');
  static final _fullDate = DateFormat("dd 'de' MMMM 'de' y", 'pt_BR');
  static final _shortDate = DateFormat('dd/MM/y', 'pt_BR');
  static final _hour = DateFormat('HH:mm', 'pt_BR');
  static final _dateHour = DateFormat('dd/MM HH:mm', 'pt_BR');
  static final _weekdayDay = DateFormat("EEEE, dd 'de' MMMM", 'pt_BR');
  static final _currency = NumberFormat.currency(
    locale: 'pt_BR',
    symbol: 'R\$',
  );
  static final _decimal = NumberFormat.decimalPattern('pt_BR');

  /// `01 de set` — para cabeçalhos curtos.
  static String dayMonth(CivilDate date) =>
      _dayMonth.format(DateTime.utc(date.year, date.month, date.day));

  /// `01 de setembro de 2026` — quando o dia precisa ser inequívoco.
  static String fullDate(CivilDate date) =>
      _fullDate.format(DateTime.utc(date.year, date.month, date.day));

  /// `01/09/2026`.
  static String shortDate(CivilDate date) =>
      _shortDate.format(DateTime.utc(date.year, date.month, date.day));

  /// `sexta-feira, 06 de setembro` — o cabeçalho de "hoje".
  ///
  /// Recebe um **instante** e o lê no relógio do aparelho, de propósito: é a
  /// única data da interface que descreve onde a pessoa está agora, e não um
  /// prazo da operação. Prazo continua vindo decidido do servidor.
  static String weekdayAndDay(DateTime instant) =>
      _weekdayDay.format(instant.toLocal());

  /// A hora de um **instante**, no relógio de quem está lendo.
  static String hourOf(DateTime? instant) =>
      instant == null ? '--:--' : _hour.format(instant.toLocal());

  /// Dia e hora de um **instante**, no relógio de quem está lendo.
  static String dateHourOf(DateTime? instant) =>
      instant == null ? '—' : _dateHour.format(instant.toLocal());

  /// `R$ 1.234,56`.
  static String currency(num? value) =>
      value == null ? '—' : _currency.format(value);

  /// `1.234,5` — números que não são dinheiro.
  static String number(num? value) =>
      value == null ? '—' : _decimal.format(value);

  /// Distância legível: metros abaixo de um quilômetro, quilômetros acima.
  static String distance(double? meters) {
    if (meters == null) return '—';
    if (meters < 1000) return '${meters.round()} m';
    return '${_decimal.format(meters / 1000)} km';
  }
}
