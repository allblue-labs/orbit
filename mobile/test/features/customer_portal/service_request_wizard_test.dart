/// O assistente de chamado: só o mínimo é obrigatório, e o envio é seguro.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/customer_portal/application/portal_session.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_contracts.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_repository.dart';
import 'package:orbit_operator/features/customer_portal/presentation/portal_common.dart';
import 'package:orbit_operator/features/customer_portal/presentation/service_request_wizard.dart';

import '../../support/fakes.dart';

class _Repo extends Mock implements PortalRepository {}

class _DraftFake extends Fake implements ServiceRequestDraft {}

ServiceRequest _gravado({int version = 1, List<String>? acoes}) =>
    ServiceRequest.fromJson({
      'id': 'csr-1',
      'code': 'CH-1',
      'category': {'code': 'QUESTION'},
      'subject': 'Dúvida sobre o contrato',
      'status': {'code': 'OPEN', 'label': 'Aberto'},
      'urgency': {'code': 'NORMAL'},
      'version': version,
      'allowedActions': acoes ?? ['EDIT', 'REPLY', 'CANCEL'],
      'description': 'Quero entender a frequência das visitas.',
      'details': {'siteLocation': 'Sala 2'},
    });

void main() {
  setUpAll(() => registerFallbackValue(_DraftFake()));

  late _Repo repo;
  setUp(() {
    repo = _Repo();
    when(
      () => repo.authenticator,
    ).thenReturn(InMemorySessionAuthenticator.create());
    when(
      () => repo.assets(
        page: any(named: 'page'),
        search: any(named: 'search'),
      ),
    ).thenAnswer(
      (_) async => const PortalPage(items: [], total: 0, hasNextPage: false),
    );
  });

  Future<void> montar(WidgetTester tester, Widget tela) async {
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          portalTokenStorageProvider.overrideWithValue(InMemoryTokenStorage()),
          portalRepositoryProvider.overrideWithValue(repo),
        ],
        child: MaterialApp(theme: OrbitTheme.light(), home: tela),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> continuar(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('wizard.next')));
    await tester.pumpAndSettle();
  }

  testWidgets('pede só categoria, assunto e descrição — o resto se pula', (
    tester,
  ) async {
    when(
      () => repo.openServiceRequest(
        any(),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer((_) async => _gravado());
    await montar(tester, const ServiceRequestWizard());

    await continuar(tester);
    expect(find.text('Escolha do que se trata o chamado.'), findsOneWidget);

    await tester.tap(find.text('Tirar uma dúvida'));
    await continuar(tester); // categoria
    await continuar(tester); // equipamento: opcional
    expect(
      find.text('Tirar uma dúvida'),
      findsOneWidget,
      reason: 'o assunto vem sugerido pela categoria',
    );

    await continuar(tester);
    expect(
      find.text('Descreva o que está acontecendo (pelo menos 5 letras).'),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const Key('wizard.description')),
      'Quero entender a frequência.',
    );
    await continuar(tester); // descrição
    await continuar(tester); // visita: opcional
    await continuar(tester); // revisão → envia

    final captura = verify(
      () => repo.openServiceRequest(
        captureAny(),
        idempotencyKey: captureAny(named: 'idempotencyKey'),
      ),
    )..called(1);
    final rascunho = captura.captured[0] as ServiceRequestDraft;
    final chave = captura.captured[1] as String;
    expect(rascunho.category, ServiceRequestCategory.question);
    expect(rascunho.subject, 'Tirar uma dúvida');
    expect(rascunho.toJson()['urgency'], 'NORMAL');
    expect(RegExp(r'^[A-Za-z0-9._:-]{8,160}$').hasMatch(chave), isTrue);
  });

  test('o melhor horário vira um texto que o técnico lê', () {
    expect(
      visitPreferenceLabel(DateTime(2026, 11, 26, 9, 0)),
      'qui, 26/11/2026 às 09:00',
    );
    expect(
      visitPreferenceLabel(DateTime(2026, 11, 29, 14, 30)),
      'dom, 29/11/2026 às 14:30',
    );
  });

  testWidgets('o melhor dia e horário vem do calendário e do relógio', (
    tester,
  ) async {
    when(
      () => repo.openServiceRequest(
        any(),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer((_) async => _gravado());
    await montar(tester, const ServiceRequestWizard());
    await tester.tap(find.text('Tirar uma dúvida'));
    await continuar(tester);
    await continuar(tester);
    await tester.enterText(
      find.byKey(const Key('wizard.description')),
      'Quero entender a frequência.',
    );
    await continuar(tester);

    /* Passo da visita: nada de digitar — um campo que abre o calendário. */
    expect(find.text('Escolher data e horário'), findsOneWidget);
    await tester.tap(find.byKey(const Key('visit.preference')));
    await tester.pumpAndSettle();
    expect(find.text('Melhor dia para a visita'), findsOneWidget);
    await tester.tap(find.text('Continuar').last); // amanhã, já marcado
    await tester.pumpAndSettle();
    expect(find.text('Melhor horário'), findsOneWidget);
    await tester.tap(find.text('Confirmar')); // 09:00
    await tester.pumpAndSettle();

    final agora = DateTime.now();
    final esperado = visitPreferenceLabel(
      DateTime(agora.year, agora.month, agora.day + 1, 9),
    );
    expect(find.text(esperado), findsOneWidget);

    /* Limpar volta ao campo vazio; escolher de novo preenche. */
    await tester.tap(find.byKey(const Key('visit.preference.clear')));
    await tester.pumpAndSettle();
    expect(find.text('Escolher data e horário'), findsOneWidget);
    await tester.tap(find.byKey(const Key('visit.preference')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continuar').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar'));
    await tester.pumpAndSettle();

    await continuar(tester); // visita
    expect(find.text(esperado), findsOneWidget, reason: 'aparece na revisão');
    await continuar(tester); // envia

    final rascunho =
        verify(
              () => repo.openServiceRequest(
                captureAny(),
                idempotencyKey: any(named: 'idempotencyKey'),
              ),
            ).captured.single
            as ServiceRequestDraft;
    expect(rascunho.availability, esperado);
    expect((rascunho.toJson()['details'] as Map)['availability'], esperado);
  });

  testWidgets('a nova tentativa depois de uma falha usa a mesma chave', (
    tester,
  ) async {
    var tentativas = 0;
    when(
      () => repo.openServiceRequest(
        any(),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer((_) async {
      tentativas += 1;
      if (tentativas == 1) throw Exception('rede');
      return _gravado();
    });
    await montar(tester, const ServiceRequestWizard());
    await tester.tap(find.text('Tirar uma dúvida'));
    await continuar(tester);
    await continuar(tester);
    await tester.enterText(
      find.byKey(const Key('wizard.description')),
      'Quero entender a frequência.',
    );
    await continuar(tester);
    await continuar(tester);
    await continuar(tester); // falha
    await continuar(tester); // tenta de novo

    final chaves = verify(
      () => repo.openServiceRequest(
        any(),
        idempotencyKey: captureAny(named: 'idempotencyKey'),
      ),
    ).captured;
    expect(chaves, hasLength(2));
    expect(chaves[0], chaves[1]);
  });

  testWidgets('editar parte do que está gravado e manda a versão vista', (
    tester,
  ) async {
    when(
      () => repo.updateServiceRequest(
        any(),
        any(),
        expectedVersion: any(named: 'expectedVersion'),
      ),
    ).thenAnswer((_) async => _gravado(version: 5));
    await montar(tester, ServiceRequestWizard(editing: _gravado(version: 4)));

    await continuar(tester);
    await continuar(tester);
    expect(find.text('Dúvida sobre o contrato'), findsOneWidget);
    await continuar(tester);
    expect(find.text('Sala 2'), findsOneWidget);
    await continuar(tester);
    expect(find.text('Salvar alterações'), findsOneWidget);
    await continuar(tester);

    final captura = verify(
      () =>
          repo.updateServiceRequest('csr-1', captureAny(), expectedVersion: 4),
    )..called(1);
    final rascunho = captura.captured.single as ServiceRequestDraft;
    expect(rascunho.subject, 'Dúvida sobre o contrato');
    expect(rascunho.toJson()['details'], {'siteLocation': 'Sala 2'});
    verifyNever(
      () => repo.openServiceRequest(
        any(),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    );
  });
}
