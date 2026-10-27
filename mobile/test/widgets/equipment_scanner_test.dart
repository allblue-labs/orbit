import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/equipment/presentation/equipment_scanner_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const _token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

class _Camera extends MobileScannerPlatform {
  final captures = StreamController<BarcodeCapture>.broadcast();
  int stops = 0;
  @override
  Stream<BarcodeCapture> get barcodesStream => captures.stream;
  @override
  Stream<TorchState> get torchStateStream => const Stream.empty();
  @override
  Stream<double> get zoomScaleStateStream => const Stream.empty();
  @override
  Widget buildCameraView() => const SizedBox.expand();
  @override
  Future<MobileScannerViewAttributes> start(StartOptions options) async =>
      const MobileScannerViewAttributes(
        cameraDirection: CameraFacing.back,
        currentTorchMode: TorchState.off,
        size: Size(390, 600),
      );
  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> updateScanWindow(Rect? window) async {}
  @override
  Future<void> dispose() async {}
}

void main() {
  late MobileScannerPlatform original;
  late _Camera camera;
  setUpAll(() => initializeDateFormatting('pt_BR'));
  setUp(() {
    original = MobileScannerPlatform.instance;
    camera = _Camera();
    MobileScannerPlatform.instance = camera;
  });
  tearDown(() async {
    MobileScannerPlatform.instance = original;
    await camera.captures.close();
  });

  Future<List<RequestOptions>> mount(
    WidgetTester tester, {
    bool notFound = false,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final requests = <RequestOptions>[];
    Future<ResponseBody> handle(RequestOptions request) async {
      requests.add(request);
      if (notFound) {
        return jsonResponse({
          'success': false,
          'error': {
            'code': 'NOT_FOUND',
            'message': 'Equipamento não disponível.',
          },
        }, status: 404);
      }
      if (request.path.endsWith('/service-history')) {
        final page = request.queryParameters['page'] as int;
        return jsonResponse(
          envelope({
            'data': [
              {
                'id': 'attendance-$page',
                'code': 'OS-$page',
                'title': page == 1 ? 'Limpeza preventiva' : 'Reparo anterior',
                'type': 'SERVICE',
                'completedAt': '2026-10-27T12:00:00Z',
                'technicianName': 'Marina',
                'description': 'Limpeza dos filtros.',
                'observations': [
                  'Dreno desobstruído e funcionamento conferido.',
                ],
              },
            ],
            'meta': {'page': page, 'totalPages': 2, 'total': 2, 'limit': 1},
          }),
        );
      }
      return jsonResponse(
        envelope({
          'id': 'equipment-1',
          'code': 'EQP-001',
          'name': 'Split sala principal',
          'type': 'EQUIPMENT',
          'status': 'ACTIVE',
          'brand': 'LG',
          'model': '18K',
          'serialNumber': '123',
          'customer': {'id': 'customer-1', 'name': 'Cliente da sala'},
          'serviceLocation': 'Sala 20',
          'allowedActions': ['VIEW_DETAILS', 'VIEW_HISTORY'],
          'pmocExecutableContexts': [],
          'availability': {'active': true, 'rvtExecutionIds': []},
        }),
      );
    }

    final client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      dio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
      retryDio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
    );
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => Scaffold(
            body: TextButton(
              onPressed: () => context.push<void>('/etiqueta'),
              child: const Text('QR'),
            ),
          ),
        ),
        GoRoute(
          path: '/etiqueta',
          builder: (context, state) => const EquipmentScannerScreen(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: MaterialApp.router(
          theme: OrbitTheme.light(),
          routerConfig: router,
        ),
      ),
    );
    await tester.tap(find.text('QR'));
    await tester.pumpAndSettle();
    return requests;
  }

  testWidgets(
    'a leitura abre a ficha e o histórico; duplicatas não removem a rota',
    (tester) async {
      final requests = await mount(tester);
      expect(tester.widget<MobileScanner>(find.byType(MobileScanner)).controller!.value.isRunning, isTrue);
      const capture = BarcodeCapture(
        barcodes: [
          Barcode(rawValue: 'https://orbit.allblue-labs.com/q/$_token'),
        ],
      );
      camera.captures.add(capture);
      camera.captures.add(capture);
      await tester.pumpAndSettle();
      expect(find.text('Split sala principal'), findsOneWidget);
      expect(find.text('Cliente da sala'), findsOneWidget);
      expect(find.text('Histórico de atendimentos'), findsOneWidget);
      expect(find.byType(MobileScanner), findsNothing);
      expect(camera.stops, greaterThan(0));
      expect(
        requests.where((r) => r.path.endsWith('/qr/$_token')),
        hasLength(1),
      );
      await tester.ensureVisible(
        find.text('Dreno desobstruído e funcionamento conferido.'),
      );
      expect(find.text('Limpeza dos filtros.'), findsOneWidget);
      expect(find.text('Limpeza preventiva'), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Atendimentos mais antigos'));
      await tester.tap(find.byTooltip('Atendimentos mais antigos'));
      await tester.pumpAndSettle();
      expect(find.text('Reparo anterior'), findsOneWidget);
      expect(requests.last.queryParameters['page'], 2);
      await tester.ensureVisible(find.text('Ler outra etiqueta'));
      await tester.tap(find.text('Ler outra etiqueta'));
      await tester.pumpAndSettle();
      expect(find.byType(MobileScanner), findsOneWidget);
      expect(find.text('Reparo anterior'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );

  testWidgets('entrada manual abre a mesma ficha do scanner', (tester) async {
    await mount(tester);
    await tester.tap(find.text('Digitar o código da etiqueta'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), _token);
    await tester.tap(find.text('Buscar equipamento'));
    await tester.pumpAndSettle();
    expect(find.text('Split sala principal'), findsOneWidget);
    expect(find.text('Histórico de atendimentos'), findsOneWidget);
    expect(find.byType(MobileScanner), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });

  testWidgets('QR desconhecido mostra erro e permite nova leitura', (
    tester,
  ) async {
    await mount(tester, notFound: true);
    camera.captures.add(
      const BarcodeCapture(barcodes: [Barcode(rawValue: _token)]),
    );
    await tester.pumpAndSettle();
    expect(find.text('Este registro não está disponível.'), findsOneWidget);
    await tester.tap(find.text('Ler outra'));
    await tester.pumpAndSettle();
    expect(find.byType(MobileScanner), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
}
