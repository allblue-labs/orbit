/// Infraestrutura de localização.
///
/// Escopo desta PR: obter a posição atual, extrair as coordenadas do
/// atendimento quando o backend as fornecer e calcular a distância. **Sem
/// mapa e sem navegação** — apenas a base para integrações futuras.
///
/// Limite de contrato: `Operation.location` é `Json?` **sem esquema** no
/// backend (`location?: Record<string, unknown>` no DTO). Não há garantia de
/// latitude e longitude. O extrator abaixo aceita as grafias mais comuns e,
/// quando não encontra, devolve `null` — o app declara que não sabe a
/// distância em vez de inventar uma.
library;

import 'dart:math' as math;

import 'package:geolocator/geolocator.dart';

/// Coordenada geográfica.
class GeoPoint {
  const GeoPoint({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  bool get isValid =>
      latitude.abs() <= 90 &&
      longitude.abs() <= 180 &&
      !(latitude == 0 && longitude == 0);
}

/// Por que a localização não está disponível.
enum LocationUnavailableReason {
  serviceDisabled,
  permissionDenied,
  permissionDeniedForever,
  failure,
}

/// Resultado de uma tentativa de obter a posição.
sealed class LocationResult {
  const LocationResult();
}

class LocationAvailable extends LocationResult {
  const LocationAvailable(this.point);
  final GeoPoint point;
}

class LocationUnavailable extends LocationResult {
  const LocationUnavailable(this.reason);
  final LocationUnavailableReason reason;

  String get message => switch (reason) {
    LocationUnavailableReason.serviceDisabled =>
      'Ative a localização do aparelho para ver a distância.',
    LocationUnavailableReason.permissionDenied =>
      'Permita o acesso à localização para ver a distância.',
    LocationUnavailableReason.permissionDeniedForever =>
      'Acesso à localização bloqueado nas configurações do aparelho.',
    LocationUnavailableReason.failure =>
      'Não foi possível obter sua localização agora.',
  };
}

abstract interface class LocationService {
  Future<LocationResult> currentPosition();
}

class GeolocatorLocationService implements LocationService {
  const GeolocatorLocationService();

  @override
  Future<LocationResult> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const LocationUnavailable(
        LocationUnavailableReason.serviceDisabled,
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return const LocationUnavailable(
        LocationUnavailableReason.permissionDeniedForever,
      );
    }
    if (permission == LocationPermission.denied) {
      return const LocationUnavailable(
        LocationUnavailableReason.permissionDenied,
      );
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          // Precisão média basta para distância e poupa bateria em campo.
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 12),
        ),
      );
      return LocationAvailable(
        GeoPoint(latitude: position.latitude, longitude: position.longitude),
      );
    } on Object {
      return const LocationUnavailable(LocationUnavailableReason.failure);
    }
  }
}

/// Lê coordenadas do JSON livre de `Operation.location`.
///
/// Aceita as grafias que aparecem na prática. Sem esquema no backend, essa
/// tolerância é o que existe — e a ausência é resultado legítimo.
GeoPoint? extractGeoPoint(Map<String, dynamic>? location) {
  if (location == null) return null;

  double? read(List<String> keys) {
    for (final key in keys) {
      final value = location[key];
      if (value is num) return value.toDouble();
      if (value is String) {
        final parsed = double.tryParse(value.replaceAll(',', '.'));
        if (parsed != null) return parsed;
      }
    }
    return null;
  }

  // Formato aninhado: { coordinates: { lat, lng } } ou { geo: {...} }.
  for (final key in ['coordinates', 'geo', 'position', 'coords']) {
    final nested = location[key];
    if (nested is Map<String, dynamic>) {
      final point = extractGeoPoint(nested);
      if (point != null) return point;
    }
  }

  final latitude = read(['latitude', 'lat', 'Latitude']);
  final longitude = read(['longitude', 'lng', 'lon', 'long', 'Longitude']);
  if (latitude == null || longitude == null) return null;

  final point = GeoPoint(latitude: latitude, longitude: longitude);
  return point.isValid ? point : null;
}

/// Distância em metros entre dois pontos.
///
/// Geometria (Haversine), não regra de negócio: mede a linha reta entre duas
/// coordenadas. Distância por rota exige serviço de roteamento — ver
/// `estimatedTravelTime`.
double distanceInMeters(GeoPoint from, GeoPoint to) =>
    Geolocator.distanceBetween(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
    );

String formatDistance(double meters) {
  if (meters < 1000) return '${meters.round()} m';
  final kilometers = meters / 1000;
  return kilometers < 10
      ? '${kilometers.toStringAsFixed(1)} km'
      : '${kilometers.round()} km';
}

/// Tempo estimado de deslocamento.
///
/// **Não implementado**: exige serviço de roteamento (trânsito, malha viária),
/// que o backend não expõe e que esta PR não deve integrar. Devolver uma
/// estimativa a partir da linha reta seria número inventado apresentado como
/// previsão. Fica declarado como indisponível até existir a fonte.
Duration? estimatedTravelTime({required GeoPoint from, required GeoPoint to}) =>
    null;

/// Ângulo em radianos — exposto para testes de geometria.
double degreesToRadians(double degrees) => degrees * math.pi / 180;
