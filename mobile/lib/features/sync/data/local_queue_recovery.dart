/// Dados que não puderam ser interpretados ficam no próprio arquivo local,
/// separados das intenções válidas. Nunca são enviados, exibidos ou logados.
class LocalQueueRecovery {
  const LocalQueueRecovery({required this.source, required this.value});
  final String source;
  final Object? value;

  Map<String, Object?> toJson() => {'source': source, 'value': value};

  factory LocalQueueRecovery.fromJson(Object? value) {
    if (value is Map &&
        value['source'] is String &&
        value.containsKey('value')) {
      return LocalQueueRecovery(
        source: value['source'] as String,
        value: value['value'],
      );
    }
    return LocalQueueRecovery(source: 'recovery', value: value);
  }
}

List<LocalQueueRecovery> readQueueRecovery(Object? value) {
  if (value == null) return [];
  if (value is List) return value.map(LocalQueueRecovery.fromJson).toList();
  return [LocalQueueRecovery(source: 'recovery', value: value)];
}

List<T> readQueueEntries<T>(
  Object? value, {
  required String source,
  required T Function(Map<String, Object?>) parse,
  required List<LocalQueueRecovery> recovery,
}) {
  if (value == null) return [];
  if (value is! List) {
    recovery.add(LocalQueueRecovery(source: source, value: value));
    return [];
  }
  final valid = <T>[];
  for (final entry in value) {
    try {
      valid.add(parse(Map<String, Object?>.from(entry as Map)));
    } on Object {
      recovery.add(LocalQueueRecovery(source: source, value: entry));
    }
  }
  return valid;
}
