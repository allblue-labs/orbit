/// Editar os próprios dados.
///
/// ## O que não está aqui
///
/// **E-mail.** Trocar e-mail é trocar credencial de acesso, e isso exige
/// confirmação no endereço novo — senão basta um aparelho destravado para
/// alguém assumir a conta. O fluxo existe no produto web, com a confirmação.
///
/// **Organização e unidade.** São do servidor, não da pessoa.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/media/media_type.dart';
import 'avatar_crop_sheet.dart';
import 'my_avatar.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../application/profile_providers.dart';

Future<void> showEditProfileSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.orbit.surface,
      builder: (_) => const EditProfileSheet(),
    );

class EditProfileSheet extends ConsumerStatefulWidget {
  const EditProfileSheet({super.key});

  @override
  ConsumerState<EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends ConsumerState<EditProfileSheet> {
  final _formulario = GlobalKey<FormState>();
  late final TextEditingController _nome;
  late final TextEditingController _sobrenome;
  late final TextEditingController _exibicao;
  late final TextEditingController _telefone;

  @override
  void initState() {
    super.initState();
    final usuario = ref.read(sessionProvider)?.user;
    _nome = TextEditingController(text: usuario?.firstName ?? '');
    _sobrenome = TextEditingController(text: usuario?.lastName ?? '');
    _exibicao = TextEditingController(text: usuario?.displayName ?? '');
    _telefone = TextEditingController(text: usuario?.phone ?? '');
  }

  @override
  void dispose() {
    _nome.dispose();
    _sobrenome.dispose();
    _exibicao.dispose();
    _telefone.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    if (!(_formulario.currentState?.validate() ?? false)) return;
    final ok = await ref
        .read(profileEditControllerProvider.notifier)
        .save(
          displayName: _exibicao.text.trim(),
          firstName: _texto(_nome),
          lastName: _texto(_sobrenome),
          phone: _texto(_telefone),
        );
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
      return;
    }
    _reclamar('Não foi possível salvar seus dados.');
  }

  /// Escolher, enquadrar, enviar.
  ///
  /// ## O enquadramento não é enfeite
  ///
  /// O avatar é um círculo pequeno e a foto é um retângulo grande. Sem esta
  /// etapa o recorte saía pelo centro, sem ninguém olhar — retrato em pé virava
  /// um close do pescoço.
  ///
  /// ## E conserta o envio
  ///
  /// O tipo era declarado **pela extensão do nome**. O `ImagePicker` com
  /// `imageQuality` reencoda para JPEG, então um `.png` escolhido chegava como
  /// bytes JPEG declarados como PNG — e o servidor compara o tipo detectado nos
  /// bytes com o declarado e recusa com `FILE_INVALID`. A foto subia para o
  /// storage e nunca virava avatar.
  ///
  /// Agora o PNG é produzido pelo enquadramento, e o tipo sai de
  /// `detectMimeType` sobre os bytes que de fato vão subir. Nenhum palpite.
  Future<void> _trocarFoto(ImageSource origem) async {
    final arquivo = await ImagePicker().pickImage(
      source: origem,

      /// Reduzido na captura: uma foto de 12 MP vira avatar de 88 pixels, e
      /// subir o original gasta o pacote de dados de quem está em campo.
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 85,
    );
    if (arquivo == null || !mounted) return;

    final original = await arquivo.readAsBytes();
    if (!mounted) return;

    final recortada = await showAvatarCropSheet(context, bytes: original);
    /* Desistiu do enquadramento: nada sobe. */
    if (recortada == null || !mounted) return;

    final tipo = detectMimeType(recortada);
    if (tipo == null) {
      _avisar('Não foi possível preparar a imagem.');
      return;
    }

    final ok = await ref
        .read(profileEditControllerProvider.notifier)
        .changePhoto(
          bytes: recortada,
          fileName: 'avatar.png',
          mimeType: tipo,
        );
    if (!mounted) return;
    if (!ok) _reclamar('Não foi possível atualizar sua foto.');
  }

  /// Um aviso que não vem de uma mutação, então não tem erro a consultar.
  void _avisar(String mensagem) {
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(mensagem)));
  }

  Future<void> _removerFoto() async {
    final ok = await ref
        .read(profileEditControllerProvider.notifier)
        .removePhoto();
    if (!mounted) return;
    if (!ok) _reclamar('Não foi possível remover sua foto.');
  }

  /// A frase é a do aplicativo; o objeto de erro nunca vira texto.
  ///
  /// `'Falhou: $error'` publicaria `DioException` e, com ele, o endereço do
  /// servidor na tela de quem está numa casa de máquinas.
  void _reclamar(String prefixo) {
    final erro = ref.read(profileEditControllerProvider).error;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(OrbitException.publicCopyForAny(erro, prefixo: prefixo)),
      ),
    );
  }

  String? _texto(TextEditingController controlador) {
    final valor = controlador.text.trim();
    return valor.isEmpty ? null : valor;
  }



  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final usuario = ref.watch(sessionProvider)?.user;
    final estado = ref.watch(profileEditControllerProvider);
    final ocupado = estado.isLoading;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          OrbitSpacing.ml,
          0,
          OrbitSpacing.ml,

          /// O teclado empurra a folha: sem isto o campo em foco fica
          /// embaixo dele e a pessoa digita às cegas.
          MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.ml,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Meus dados',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: OrbitSpacing.ml),

            Flexible(
              child: SingleChildScrollView(
                child: Form(
                  key: _formulario,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Column(
                          children: [
                            MyAvatar(
                              initials: usuario?.initials ?? '?',
                              size: 72,
                            ),
                            const SizedBox(height: OrbitSpacing.sm),
                            Wrap(
                              spacing: OrbitSpacing.sm,
                              children: [
                                TextButton.icon(
                                  onPressed: ocupado
                                      ? null
                                      : () => _trocarFoto(ImageSource.gallery),
                                  icon: const Icon(
                                    Icons.photo_library_outlined,
                                    size: 17,
                                  ),
                                  label: const Text('Galeria'),
                                ),
                                TextButton.icon(
                                  onPressed: ocupado
                                      ? null
                                      : () => _trocarFoto(ImageSource.camera),
                                  icon: const Icon(
                                    Icons.photo_camera_outlined,
                                    size: 17,
                                  ),
                                  label: const Text('Câmera'),
                                ),
                                if (usuario?.avatarUrl != null)
                                  TextButton(
                                    onPressed: ocupado ? null : _removerFoto,
                                    style: TextButton.styleFrom(
                                      foregroundColor: palette.danger,
                                    ),
                                    child: const Text('Remover'),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.ml),

                      TextFormField(
                        controller: _exibicao,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Como quer ser chamado',
                          helperText: 'É o nome que aparece nos documentos',
                        ),
                        validator: (valor) => (valor ?? '').trim().isEmpty
                            ? 'Informe um nome'
                            : null,
                      ),
                      const SizedBox(height: OrbitSpacing.md),
                      TextFormField(
                        controller: _nome,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'Nome'),
                      ),
                      const SizedBox(height: OrbitSpacing.md),
                      TextFormField(
                        controller: _sobrenome,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Sobrenome',
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.md),
                      TextFormField(
                        controller: _telefone,
                        keyboardType: TextInputType.phone,
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                            RegExp(r'[0-9+()\-\s]'),
                          ),
                          LengthLimitingTextInputFormatter(32),
                        ],
                        decoration: const InputDecoration(
                          labelText: 'Telefone',
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.md),

                      /// O e-mail aparece, e não se edita. Escondê-lo faria
                      /// a pessoa procurar; deixá-lo editável prometeria o
                      /// que esta tela não pode cumprir.
                      TextFormField(
                        initialValue: usuario?.email ?? '',
                        enabled: false,
                        decoration: const InputDecoration(
                          labelText: 'E-mail',
                          helperText: 'Alterado pelo Orbit no navegador',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: OrbitSpacing.ml),
            FilledButton(
              onPressed: ocupado ? null : _salvar,
              style: FilledButton.styleFrom(minimumSize: const Size(0, 50)),
              child: ocupado
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }
}
