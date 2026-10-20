/// Data civil não pertence ao aparelho.
///
/// O caso que estes testes existem para impedir é o das 22h: em Recife
/// (UTC-3), às 22h do dia 31 o relógio em UTC já marca o dia 1º. Uma tela que
/// derive "hoje" do aparelho pede a agenda do dia errado — e o técnico não vê
/// o próprio trabalho.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/time/civil_time.dart';

void main() {
  group('CivilDate', () {
    test('lê o formato que o backend publica', () {
      final date = CivilDate.tryParse('2026-09-01');
      expect(date, const CivilDate(2026, 9, 1));
      expect(date!.toIsoString(), '2026-09-01');
    });

    test('recusa o que não é data civil', () {
      expect(CivilDate.tryParse(null), isNull);
      expect(CivilDate.tryParse('ontem'), isNull);
      expect(CivilDate.tryParse('2026-13-01'), isNull);
      expect(CivilDate.tryParse('2026-09-32'), isNull);
    });

    test('lê a data de um instante ISO sem se perder na hora', () {
      /// O backend às vezes manda a data civil dentro de um ISO completo.
      expect(
        CivilDate.tryParse('2026-09-01T23:30:00.000Z'),
        const CivilDate(2026, 9, 1),
      );
    });

    test('anda no calendário, inclusive virando o mês e o ano', () {
      expect(
        const CivilDate(2026, 8, 31).addDays(1),
        const CivilDate(2026, 9, 1),
      );
      expect(
        const CivilDate(2026, 1, 1).addDays(-1),
        const CivilDate(2025, 12, 31),
      );

      /// Fevereiro bissexto — o calendário resolve, não a aritmética de 30.
      expect(
        const CivilDate(2024, 2, 28).addDays(1),
        const CivilDate(2024, 2, 29),
      );
    });

    test('ordena por calendário', () {
      expect(
        const CivilDate(2026, 9, 1).compareTo(const CivilDate(2026, 9, 2)),
        lessThan(0),
      );
      expect(
        const CivilDate(2026, 10, 1).compareTo(const CivilDate(2026, 9, 30)),
        greaterThan(0),
      );
    });
  });

  group('OrbitClock', () {
    /// 2026-09-01T01:30Z — que em Recife (UTC-3) ainda é 31 de agosto, 22h30.
    final instant = DateTime.utc(2026, 9, 1, 1, 30);
    final clock = OrbitClock(now: () => instant);

    test('o dia depende do fuso perguntado, não do aparelho', () {
      expect(
        clock.today(offset: const Duration(hours: -3)),
        const CivilDate(2026, 8, 31),
        reason: 'em Recife ainda é dia 31',
      );
      expect(
        clock.today(offset: Duration.zero),
        const CivilDate(2026, 9, 1),
        reason: 'em UTC já é dia 1º',
      );
      expect(
        clock.today(offset: const Duration(hours: 9)),
        const CivilDate(2026, 9, 1),
      );
    });

    test('o instante continua sendo o mesmo ponto no tempo', () {
      expect(clock.instant(), instant);
    });
  });
}
