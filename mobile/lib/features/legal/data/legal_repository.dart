import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/orbit_api_client.dart';

enum LegalDocumentKind {
  privacy('privacidade', 'Política de Privacidade'),
  terms('termos', 'Termos de Uso');

  const LegalDocumentKind(this.slug, this.title);
  final String slug;
  final String title;
}

class LegalDocument {
  const LegalDocument({
    required this.title,
    required this.version,
    required this.effectiveAt,
    required this.provider,
    required this.sections,
  });
  final String title;
  final String version;
  final String effectiveAt;
  final Map<String, dynamic> provider;
  final List<LegalSection> sections;

  factory LegalDocument.fromJson(Map<String, dynamic> json) => LegalDocument(
    title: json['title'] as String,
    version: json['version'] as String,
    effectiveAt: json['effectiveAt'] as String,
    provider: Map<String, dynamic>.from(json['provider'] as Map),
    sections: (json['sections'] as List).map((entry) {
      final section = Map<String, dynamic>.from(entry as Map);
      return LegalSection(
        section['title'] as String,
        (section['paragraphs'] as List).cast<String>(),
      );
    }).toList(),
  );
}

class LegalSection {
  const LegalSection(this.title, this.paragraphs);
  final String title;
  final List<String> paragraphs;
}

class LegalRepository {
  const LegalRepository(this._client);
  final OrbitApiClient _client;

  Future<LegalDocument> read(LegalDocumentKind kind) async =>
      LegalDocument.fromJson(
        await _client.get<Map<String, dynamic>>(
          '/legal/documents/${kind.slug}',
          isPublic: true,
        ),
      );
}

// O documento é público e não usa o cliente fechado do contexto sem sessão.
// SessionRuntime compartilha apenas este repositório público com a raiz.
final legalRepositoryProvider = Provider<LegalRepository>(
  (ref) => LegalRepository(ref.watch(apiClientProvider)),
);
final legalDocumentProvider = FutureProvider.autoDispose
    .family<LegalDocument, LegalDocumentKind>(
      (ref, kind) => ref.watch(legalRepositoryProvider).read(kind),
    );
