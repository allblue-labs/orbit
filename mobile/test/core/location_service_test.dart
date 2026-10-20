/// Localização.
///
/// O ponto sensível é a leitura de coordenadas: `Operation.location` é JSON
/// livre no backend, sem esquema. O extrator precisa ser tolerante com as
/// grafias que aparecem e honesto quando não há coordenada alguma.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/location/location_service.dart';

void main() {
  group('extração de coordenadas do JSON livre', () {
    test('lê latitude e longitude diretas', () {
      final point = extractGeoPoint({'latitude': -8.05, 'longitude': -34.9});
      expect(point, isNotNull);
      expect(point!.latitude, -8.05);
      expect(point.longitude, -34.9);
    });

    test('aceita as abreviações usuais', () {
      final point = extractGeoPoint({'lat': -23.55, 'lng': -46.63});
      expect(point?.latitude, -23.55);
      expect(point?.longitude, -46.63);
    });

    test('aceita formato aninhado', () {
      final point = extractGeoPoint({
        'address': 'Rua A, 100',
        'coordinates': {'lat': -8.05, 'lon': -34.9},
      });
      expect(point?.latitude, -8.05);
    });

    test('aceita número em texto, com vírgula decimal', () {
      final point = extractGeoPoint({'lat': '-8,05', 'lng': '-34,90'});
      expect(point?.latitude, -8.05);
      expect(point?.longitude, -34.9);
    });

    test('sem coordenadas, devolve nulo em vez de inventar', () {
      expect(extractGeoPoint(null), isNull);
      expect(extractGeoPoint({}), isNull);
      expect(
        extractGeoPoint({'address': 'Rua A, 100', 'city': 'Recife'}),
        isNull,
      );
      expect(extractGeoPoint({'latitude': -8.05}), isNull, reason: 'falta lng');
    });

    test('descarta coordenadas inválidas', () {
      expect(extractGeoPoint({'lat': 200, 'lng': 10}), isNull);
      expect(
        extractGeoPoint({'lat': 0, 'lng': 0}),
        isNull,
        reason: 'ilha nula costuma ser dado ausente, não posição real',
      );
    });
  });

  group('apresentação da distância', () {
    test('metros abaixo de um quilômetro', () {
      expect(formatDistance(340), '340 m');
    });

    test('quilômetros com uma casa até dez', () {
      expect(formatDistance(2400), '2.4 km');
    });

    test('quilômetros inteiros acima de dez', () {
      expect(formatDistance(24000), '24 km');
    });
  });

  test('tempo estimado é declarado indisponível', () {
    // Exige serviço de roteamento; estimar pela linha reta seria inventar.
    const from = GeoPoint(latitude: -8.05, longitude: -34.9);
    const to = GeoPoint(latitude: -8.06, longitude: -34.91);
    expect(estimatedTravelTime(from: from, to: to), isNull);
  });

  test('validação de ponto geográfico', () {
    expect(const GeoPoint(latitude: -8.05, longitude: -34.9).isValid, isTrue);
    expect(const GeoPoint(latitude: 91, longitude: 0).isValid, isFalse);
    expect(const GeoPoint(latitude: 0, longitude: 181).isValid, isFalse);
  });
}
