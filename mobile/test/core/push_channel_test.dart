import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/push/push_channel.dart';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'trocar sessão mantém a nova escuta nativa depois de cancelar a anterior',
    () async {
      const channel = MethodChannel('test/orbit/push/token');
      final calls = <String>[];
      binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        calls.add(call.method);
        return null;
      });
      addTearDown(
        () => binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      final source = PushChannel(
        tokens: const EventChannel('test/orbit/push/token'),
      );
      final oldValues = <String>[];
      final newValues = <String>[];
      final oldSession = source.onTokenRefresh.listen(oldValues.add);
      final newSession = source.onTokenRefresh.listen(newValues.add);
      await pumpEventQueue();
      await oldSession.cancel();
      binding.channelBuffers.push(
        'test/orbit/push/token',
        const StandardMethodCodec().encodeSuccessEnvelope('new-device-token'),
        (_) {},
      );
      await pumpEventQueue();
      expect(oldValues, isEmpty);
      expect(newValues, ['new-device-token']);
      expect(calls, ['listen']);
      await newSession.cancel();
      await pumpEventQueue();
      expect(calls, ['listen', 'cancel']);
    },
  );
}
