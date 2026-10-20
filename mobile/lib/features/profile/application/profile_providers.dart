/// Editar os próprios dados.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/profile_repository.dart';

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => ProfileRepository(client: ref.watch(apiClientProvider)),
);

/// O que está acontecendo com a edição.
///
/// `AsyncValue<void>` e não um booleano: a folha precisa distinguir "salvando"
/// de "falhou", e um `bool salvando` obriga a carregar o erro num segundo
/// campo que alguém esquece de limpar.
class ProfileEditController extends StateNotifier<AsyncValue<void>> {
  ProfileEditController(this._ref) : super(const AsyncValue.data(null));

  final Ref _ref;

  /// Salva e **aplica na sessão**.
  ///
  /// Sem o segundo passo a pessoa salva, fecha a folha e continua vendo o
  /// nome antigo no topo — e conclui que não salvou.
  Future<bool> save({
    required String displayName,
    String? firstName,
    String? lastName,
    String? phone,
  }) async {
    state = const AsyncValue.loading();
    try {
      final user = await _ref
          .read(profileRepositoryProvider)
          .update(
            displayName: displayName,
            firstName: firstName,
            lastName: lastName,
            phone: phone,
          );
      _ref.read(authControllerProvider.notifier).applyUser(user);

      /// `mounted` antes de escrever: o provedor é `autoDispose`, e a folha
      /// pode ter sido fechada enquanto a requisição estava no ar.
      if (mounted) state = const AsyncValue.data(null);
      return true;
    } on Object catch (error, stack) {
      if (mounted) state = AsyncValue.error(error, stack);
      return false;
    }
  }

  /// Troca a foto: reserva, envia os bytes, ativa.
  ///
  /// Os três passos são um só para quem chama — uma falha no meio deixa um
  /// objeto órfão no armazenamento, e é o servidor que o recolhe. O que não
  /// pode acontecer é a foto aparecer pela metade na tela.
  Future<bool> changePhoto({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    state = const AsyncValue.loading();
    try {
      final repository = _ref.read(profileRepositoryProvider);
      final ticket = await repository.reserveAvatar(
        fileName: fileName,
        mimeType: mimeType,
        sizeBytes: bytes.length,
      );
      await repository.putAvatarBytes(
        ticket: ticket,
        bytes: bytes,
        mimeType: mimeType,
      );
      await repository.activateAvatar(ticket.storageObjectId);

      /// A sessão é recomposta para o nome e o resto do perfil seguirem
      /// atuais; a foto em si vem de `avatarBytesProvider`, que precisa ser
      /// relido — sem isto a tela segue mostrando a imagem anterior, já em
      /// memória, e a troca parece não ter acontecido.
      _ref.invalidate(avatarBytesProvider);
      await _ref.read(authControllerProvider.notifier).refreshProfile();

      /// `mounted` antes de escrever: o provedor é `autoDispose`, e a folha
      /// pode ter sido fechada enquanto a requisição estava no ar.
      if (mounted) state = const AsyncValue.data(null);
      return true;
    } on Object catch (error, stack) {
      if (mounted) state = AsyncValue.error(error, stack);
      return false;
    }
  }

  Future<bool> removePhoto() async {
    state = const AsyncValue.loading();
    try {
      await _ref.read(profileRepositoryProvider).removeAvatar();
      _ref.invalidate(avatarBytesProvider);
      await _ref.read(authControllerProvider.notifier).refreshProfile();

      /// `mounted` antes de escrever: o provedor é `autoDispose`, e a folha
      /// pode ter sido fechada enquanto a requisição estava no ar.
      if (mounted) state = const AsyncValue.data(null);
      return true;
    } on Object catch (error, stack) {
      if (mounted) state = AsyncValue.error(error, stack);
      return false;
    }
  }
}

final profileEditControllerProvider =
    StateNotifierProvider.autoDispose<ProfileEditController, AsyncValue<void>>(
      ProfileEditController.new,
    );


/// Os bytes da foto de perfil.
///
/// ## Por que bytes, e não a URL da sessão
///
/// O endereço da foto é **assinado e curto** — cinco minutos no padrão do
/// servidor. A sessão guardava esse endereço e o entregava a `Image.network`
/// pelo resto do uso: passados os cinco minutos o `GET` respondia 403 e a tela
/// caía nas iniciais, sem erro e sem explicação. A foto aparecia por alguns
/// minutos depois de trocada e sumia sozinha.
///
/// Buscar os bytes resolve isso na raiz: o endereço é pedido na hora, usado
/// imediatamente e descartado. É o mesmo caminho da prévia da assinatura, que
/// já tratava a expiração assim.
///
/// A repetição única cobre o endereço que vence **entre** pedir e usar — a
/// corrida que a folga de dez segundos reduz mas não elimina.
final avatarBytesProvider = FutureProvider<Uint8List?>((ref) async {
  final repository = ref.watch(profileRepositoryProvider);

  for (var tentativa = 0; tentativa < 2; tentativa += 1) {
    final view = await repository.avatar();
    if (!view.available || view.url == null) return null;
    if (view.isExpired && tentativa == 0) continue;

    try {
      return await repository.avatarBytes(Uri.parse(view.url!));
    } on Object {
      if (tentativa == 1) rethrow;
    }
  }
  return null;
});
