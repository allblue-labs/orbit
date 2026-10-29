import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/network/orbit_interceptors.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/presentation/orbit_format.dart';
import 'package:orbit_operator/core/time/civil_time.dart';
import 'package:orbit_operator/core/time/orbit_timezone.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';
import 'package:orbit_operator/features/documents/presentation/documents_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

final selectedSession = StateProvider<OrbitSession?>((_) => null);
OrbitSession session(String user, String? timezone) => OrbitSession(
  user: OrbitUser(
    id: user,
    email: '$user@example.test',
    displayName: user,
    timezone: timezone,
  ),
  claims: AccessTokenClaims.fromJson({
    'sub': user,
    'sid': user,
    'businessUnitId': 'bu',
  }),
  organization: const Organization(
    id: 'org',
    displayName: 'Org',
    subscriptionStatus: 'ACTIVE',
    businessUnits: [
      BusinessUnit(id: 'bu', legalName: 'Unidade', timezone: 'America/Manaus'),
    ],
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  test('prioriza a conta e usa unidade/padrão para preferências inválidas', () {
    final container = ProviderContainer(
      overrides: [
        sessionProvider.overrideWith((ref) => ref.watch(selectedSession)),
      ],
    );
    addTearDown(container.dispose);
    container.read(selectedSession.notifier).state = session('A', 'Asia/Tokyo');
    expect(container.read(userTimezoneProvider).name, 'Asia/Tokyo');
    container.read(selectedSession.notifier).state = session(
      'A',
      'invalid/timezone',
    );
    expect(container.read(userTimezoneProvider).name, 'America/Manaus');
    container.read(selectedSession.notifier).state = session('A', null)
        .copyWith(
          organization: const Organization(
            id: 'org',
            displayName: 'Org',
            subscriptionStatus: 'ACTIVE',
            businessUnits: [
              BusinessUnit(
                id: 'other',
                legalName: 'Outra',
                timezone: 'America/Manaus',
              ),
              BusinessUnit(
                id: 'primary',
                legalName: 'Matriz',
                isPrimary: true,
                timezone: 'Europe/Lisbon',
              ),
            ],
          ),
        );
    expect(container.read(userTimezoneProvider).name, 'Europe/Lisbon');
    container.read(selectedSession.notifier).state = null;
    expect(
      container.read(userTimezoneProvider).name,
      OrbitTimezone.defaultName,
    );
  });

  test(
    'formatação respeita IANA e horário de verão sem mudar a data civil',
    () {
      final newYork = OrbitDateTimeFormat(
        OrbitTimezone.resolve(['America/New_York']),
      );
      final tokyo = OrbitDateTimeFormat(OrbitTimezone.resolve(['Asia/Tokyo']));
      expect(newYork.hourOf(DateTime.utc(2026, 1, 15, 15)), '10:00');
      expect(newYork.hourOf(DateTime.utc(2026, 7, 15, 15)), '11:00');
      expect(tokyo.dateHourOf(DateTime.utc(2026, 10, 29, 23)), '30/10 08:00');
      expect(
        OrbitFormat.shortDate(const CivilDate(2026, 10, 29)),
        '29/10/2026',
      );
      final now = DateTime.utc(2026, 10, 30, 2);
      expect(OrbitTimezone.resolve(['Brazil/East']).name, 'Brazil/East');
      expect(
        rotuloDoDia(DateTime.utc(2026, 10, 29, 23), agora: now, format: tokyo),
        'Hoje',
      );
      expect(
        rotuloDoDia(
          DateTime.utc(2026, 10, 29, 23),
          agora: now,
          format: newYork,
        ),
        'Hoje',
      );
      // Mudança de dia pessoal não usa o calendário do aparelho.
      expect(
        rotuloDoDia(DateTime.utc(2026, 10, 29, 14), agora: now, format: tokyo),
        'Ontem',
      );
    },
  );

  test(
    'cada nova requisição usa a preferência atual, inclusive após trocar a conta',
    () async {
      final container = ProviderContainer(
        overrides: [
          sessionProvider.overrideWith((ref) => ref.watch(selectedSession)),
        ],
      );
      addTearDown(container.dispose);
      final headers = <String>[];
      final client = OrbitApiClient.create(
        environment: OrbitEnvironment.fromDefines(),
        storage: InMemoryTokenStorage(),
        logger: const OrbitLogger(isProduction: true),
        timezoneProvider: () => container.read(userTimezoneProvider).name,
        dio: Dio()
          ..httpClientAdapter = ScriptedAdapter((options) async {
            headers.add(options.headers[ContextHeaders.timezone] as String);
            return jsonResponse(envelope({}));
          }),
      );
      container.read(selectedSession.notifier).state = session(
        'A',
        'Asia/Tokyo',
      );
      await client.scoped().get<dynamic>('/timezone-check');
      container.read(selectedSession.notifier).state = session(
        'A',
        'America/New_York',
      );
      await client.scoped().get<dynamic>('/timezone-check');
      container.read(selectedSession.notifier).state = session(
        'B',
        'Europe/Lisbon',
      );
      await client.scoped().get<dynamic>('/timezone-check');
      expect(headers, ['Asia/Tokyo', 'America/New_York', 'Europe/Lisbon']);
    },
  );

  testWidgets(
    'mudança da conta/preferência atualiza os horários sem estado global',
    (tester) async {
      final container = ProviderContainer(
        overrides: [
          sessionProvider.overrideWith((ref) => ref.watch(selectedSession)),
        ],
      );
      addTearDown(container.dispose);
      container.read(selectedSession.notifier).state = session(
        'A',
        'Asia/Tokyo',
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) => OrbitTimeScope(
              timezone: ref.watch(userTimezoneProvider),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: Builder(
                  builder: (context) => Text(
                    OrbitFormat.of(
                      context,
                    ).hourOf(DateTime.utc(2026, 10, 29, 15)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.text('00:00'), findsOneWidget);
      container.read(selectedSession.notifier).state = session(
        'B',
        'America/Manaus',
      );
      await tester.pump();
      expect(find.text('11:00'), findsOneWidget);
      expect(find.text('00:00'), findsNothing);
    },
  );
}
