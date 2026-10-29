import 'package:timezone/data/latest_all.dart' as data;
import 'package:timezone/timezone.dart' as tz;

/// Resolve nomes IANA sem alterar o fuso global do processo. Cada sessão e
/// formatador conserva seu próprio contexto, inclusive durante uma troca de conta.
class OrbitTimezone {
  OrbitTimezone._(this.location);

  static const defaultName = 'America/Recife';
  static bool _initialized = false;
  final tz.Location location;
  String get name => location.name;

  factory OrbitTimezone.resolve([Iterable<String?> candidates = const []]) {
    if (!_initialized) {
      data.initializeTimeZones();
      _initialized = true;
    }
    for (final candidate in [...candidates, defaultName]) {
      if (candidate == null || candidate.trim().isEmpty) continue;
      try {
        return OrbitTimezone._(tz.getLocation(candidate.trim()));
      } on tz.LocationNotFoundException {
        // Uma preferência antiga/inválida não deve impedir abrir o app.
      }
    }
    return OrbitTimezone._(tz.UTC);
  }

  DateTime at(DateTime instant) => tz.TZDateTime.from(instant, location);
}
