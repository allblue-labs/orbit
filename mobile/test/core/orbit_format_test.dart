/// Formatação em português, e a fronteira entre instante e data civil.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/presentation/orbit_format.dart';
import 'package:orbit_operator/core/time/civil_time.dart';

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  group('data civil', () {
    const date = CivilDate(2026, 9, 1);

    test('sai em português, sem tradução pela metade', () {
      expect(OrbitFormat.fullDate(date), '01 de setembro de 2026');

      /// O `intl` abrevia com ponto em pt_BR — "set." é a forma correta, e o
      /// teste segue a locale em vez de impor um palpite.
      expect(OrbitFormat.dayMonth(date), '01 de set.');
      expect(OrbitFormat.shortDate(date), '01/09/2026');
    });

    test('não muda com o fuso do aparelho', () {
      /// A data civil é um dia no calendário, não um ponto no tempo. Formatá-la
      /// não pode depender de onde está quem lê — este é o teste que reprova a
      /// tentação de passá-la por `toLocal()`.
      final formatted = OrbitFormat.fullDate(const CivilDate(2026, 1, 1));
      expect(formatted, '01 de janeiro de 2026');
    });
  });

  group('instante', () {
    test('a hora é exibida no relógio de quem lê', () {
      final instant = DateTime.utc(2026, 9, 1, 15, 30);

      /// O teste roda no fuso do ambiente; o que se prova é a consistência
      /// entre o que o formatador diz e o que `toLocal()` resolve — não um
      /// horário fixo, que amarraria o teste a uma máquina.
      final local = instant.toLocal();
      final expected =
          '${local.hour.toString().padLeft(2, '0')}:'
          '${local.minute.toString().padLeft(2, '0')}';
      expect(OrbitFormat.hourOf(instant), expected);
    });

    test('ausência vira traço, não texto vazio nem "null"', () {
      expect(OrbitFormat.hourOf(null), '--:--');
      expect(OrbitFormat.dateHourOf(null), '—');
    });
  });

  group('números', () {
    test('moeda em real, com separador brasileiro', () {
      expect(OrbitFormat.currency(1234.56), contains('1.234,56'));
      expect(OrbitFormat.currency(1234.56), contains(r'R$'));
      expect(OrbitFormat.currency(null), '—');
    });

    test('distância troca de unidade no quilômetro', () {
      expect(OrbitFormat.distance(850), '850 m');
      expect(OrbitFormat.distance(1500), '1,5 km');
      expect(OrbitFormat.distance(null), '—');
    });
  });
}
