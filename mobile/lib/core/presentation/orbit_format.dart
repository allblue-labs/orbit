/// Formatação em português — um lugar só.
///
/// Antes desta PR cada tela montava a sua: `padLeft` para horas, um array de
/// meses aqui, outro ali. O resultado é o de sempre — o mesmo dado aparecendo
/// de três formas, e a correção de uma delas não alcançando as outras.
///
/// ## Instante e data civil não se formatam igual
///
/// Um **instante** (`DateTime`) é o mesmo ponto no tempo para todo mundo;
/// exibi-lo na preferência de fuso da conta é o que `of(context)` faz.
///
/// Uma **data civil** ([CivilDate]) é um dia no calendário de alguém. Ela chega
/// decidida pelo backend, no fuso da unidade, e aqui só vira texto. Não há
/// função que converta uma na outra — de propósito: essa conversão é
/// exatamente o erro que separa "hoje" de "ontem" para quem está viajando.
library;

import 'package:intl/intl.dart';
import 'package:flutter/widgets.dart';

import '../time/civil_time.dart';
import '../time/orbit_timezone.dart';

abstract final class OrbitFormat {
  static OrbitDateTimeFormat of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OrbitTimeScope>()?.format ??
      OrbitDateTimeFormat(OrbitTimezone.resolve());
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
  /// Variante sem contexto usa o padrão da aplicação. Nas telas, use
  /// `of(context)` para acompanhar a preferência da conta ativa.
  static String weekdayAndDay(DateTime instant) =>
      OrbitDateTimeFormat(OrbitTimezone.resolve()).weekdayAndDay(instant);

  /// A hora de um **instante**, no relógio de quem está lendo.
  static String hourOf(DateTime? instant) =>
      OrbitDateTimeFormat(OrbitTimezone.resolve()).hourOf(instant);

  /// Dia e hora de um **instante**, no relógio de quem está lendo.
  static String dateHourOf(DateTime? instant) =>
      OrbitDateTimeFormat(OrbitTimezone.resolve()).dateHourOf(instant);

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

class OrbitDateTimeFormat {
  const OrbitDateTimeFormat(this.timezone);
  final OrbitTimezone timezone;
  DateTime at(DateTime instant) => timezone.at(instant);
  String hourOf(DateTime? instant) =>
      instant == null ? '--:--' : OrbitFormat._hour.format(at(instant));
  String dateHourOf(DateTime? instant) =>
      instant == null ? '—' : OrbitFormat._dateHour.format(at(instant));
  String weekdayAndDay(DateTime instant) =>
      OrbitFormat._weekdayDay.format(at(instant));
}

class OrbitTimeScope extends InheritedWidget {
  OrbitTimeScope({
    super.key,
    required OrbitTimezone timezone,
    required super.child,
  }) : format = OrbitDateTimeFormat(timezone);
  final OrbitDateTimeFormat format;
  @override
  bool updateShouldNotify(OrbitTimeScope oldWidget) =>
      oldWidget.format.timezone.name != format.timezone.name;
}
