import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/profile/application/profile_providers.dart';
import 'package:orbit_operator/features/profile/presentation/edit_profile_sheet.dart';

class _Picker extends Mock implements ImagePicker {}

class _File extends Mock implements XFile {}

void main() {
  late _Picker picker;
  setUp(() => picker = _Picker());

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          avatarImagePickerProvider.overrideWithValue(picker),
          sessionProvider.overrideWithValue(null),
          avatarBytesProvider.overrideWith((_) async => null),
        ],
        child: MaterialApp(
          theme: OrbitTheme.light(),
          home: const Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(height: 650, child: EditProfileSheet()),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final source in ImageSource.values) {
    testWidgets(
      'permissão de ${source.name} negada é explicada sem expor detalhes técnicos',
      (tester) async {
        when(
          () => picker.pickImage(
            source: source,
            maxWidth: 1024,
            maxHeight: 1024,
            imageQuality: 85,
          ),
        ).thenThrow(
          PlatformException(
            code: 'camera_access_denied',
            message: 'native_private_details',
          ),
        );
        await open(tester);
        await tester.tap(
          find.text(source == ImageSource.camera ? 'Câmera' : 'Galeria'),
        );
        await tester.pump();
        expect(
          find.textContaining(
            'Confira as permissões nas configurações do aparelho',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('native_private_details'), findsNothing);
        expect(tester.takeException(), isNull);
        expect(
          tester
              .widget<TextButton>(find.widgetWithText(TextButton, 'Galeria'))
              .onPressed,
          isNotNull,
        );
      },
    );
  }

  testWidgets('falha ao ler a imagem mostra erro e libera nova tentativa', (
    tester,
  ) async {
    final file = _File();
    when(
      () => picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      ),
    ).thenAnswer((_) async => file);
    when(file.readAsBytes).thenThrow(const FileSystemException('private path'));
    await open(tester);
    await tester.tap(find.text('Galeria'));
    await tester.pump();
    expect(
      find.text('Não foi possível abrir a foto. Tente novamente.'),
      findsOneWidget,
    );
    expect(find.textContaining('private path'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'sair enquanto o seletor está aberto não atualiza uma tela encerrada',
    (tester) async {
      final selection = Completer<XFile?>();
      when(
        () => picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1024,
          maxHeight: 1024,
          imageQuality: 85,
        ),
      ).thenAnswer((_) => selection.future);
      await open(tester);
      await tester.tap(find.text('Câmera'));
      await tester.pump();
      await tester.pumpWidget(const SizedBox());
      selection.completeError(PlatformException(code: 'camera_access_denied'));
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
