/// A foto do próprio usuário, carregada por bytes.
///
/// ## Por que existe um widget para isto
///
/// Porque a foto do perfil não é uma imagem qualquer: o endereço dela é
/// assinado e vale cinco minutos. A sessão guardava esse endereço e o entregava
/// a `Image.network` pelo resto do uso — passados os cinco minutos o `GET`
/// respondia 403 e a tela caía nas iniciais, sem erro e sem explicação. A foto
/// aparecia logo depois de trocada e sumia sozinha.
///
/// Aqui o endereço é pedido na hora, usado e descartado. Enquanto carrega,
/// mostra as iniciais — e não um esqueleto: a inicial já é a identidade da
/// pessoa, e piscar um cinza antes dela é ruído num lugar que aparece em toda
/// tela.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_operational.dart';
import '../application/profile_providers.dart';

class MyAvatar extends ConsumerWidget {
  const MyAvatar({super.key, required this.initials, this.size = 40});

  final String initials;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    /// Falha não vira erro na tela: a inicial é uma resposta completa, e um
    /// aviso de rede ao lado do nome da pessoa não ajuda ninguém a trabalhar.
    final bytes = ref.watch(avatarBytesProvider).valueOrNull;

    return OrbitAvatar(initials: initials, bytes: bytes, size: size);
  }
}
