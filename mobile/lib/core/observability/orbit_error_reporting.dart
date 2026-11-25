import 'package:sentry_flutter/sentry_flutter.dart';

final _id = RegExp(
  r'^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$',
  caseSensitive: false,
);

Future<void> withErrorReporting(Future<void> Function() run) async {
  const dsn = String.fromEnvironment('ORBIT_SENTRY_DSN');
  if (dsn.isEmpty) return run();

  await SentryFlutter.init((options) {
    options
      ..dsn = dsn
      ..environment = const String.fromEnvironment(
        'ORBIT_SENTRY_ENVIRONMENT',
        defaultValue: 'production',
      )
      ..sendDefaultPii = false
      ..enableNativeCrashHandling = false
      ..tracesSampleRate = 0
      ..attachScreenshot = false
      ..attachViewHierarchy = false
      ..maxBreadcrumbs = 0
      ..beforeSend = (event, hint) {
        hint.attachments.clear();
        final id = event.tags?['correlationId'];
        final exceptions = event.exceptions
            ?.map(
              (exception) => SentryException(
                type: _label(exception.type) ?? 'Error',
                value: null,
                stackTrace: SentryStackTrace(
                  frames: [
                    for (final frame
                        in exception.stackTrace?.frames ?? <SentryStackFrame>[])
                      if (_source(frame.fileName) case final source?)
                        SentryStackFrame(
                          fileName: source,
                          function: _label(frame.function),
                          lineNo: frame.lineNo,
                          colNo: frame.colNo,
                        ),
                  ],
                ),
              ),
            )
            .toList();
        return SentryEvent(
          eventId: event.eventId,
          timestamp: event.timestamp,
          level: event.level,
          platform: event.platform,
          release: event.release,
          environment: event.environment,
          exceptions: exceptions,
          tags: {
            'processRole': 'mobile',
            if (id != null && _id.hasMatch(id)) 'correlationId': id,
          },
        );
      };
  }, appRunner: run);
}

String? _label(String? value) =>
    value != null && RegExp(r'^[A-Za-z_][A-Za-z0-9_.<>]{0,79}$').hasMatch(value)
    ? value
    : null;

String? _source(String? value) => value == null
    ? null
    : RegExp(
        r'(?:^|/)((?:lib|orbit_operator)/[A-Za-z0-9_./-]+\.dart)$',
      ).firstMatch(value)?.group(1);
