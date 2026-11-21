/// Perfil do cliente: foto, assinatura, senha e saída.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/design/orbit_settings_list.dart';
import '../../../core/design/orbit_signature_pad.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/media/media_type.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../legal/presentation/legal_document_screen.dart';
import '../../profile/presentation/avatar_crop_sheet.dart';
import '../../profile/presentation/edit_profile_sheet.dart'
    show avatarImagePickerProvider;
import '../application/portal_providers.dart';
import '../application/portal_session.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';
import 'portal_widgets.dart';

/// A foto do cliente, ou as iniciais quando não há.
class PortalAvatar extends ConsumerWidget {
  const PortalAvatar({super.key, this.radius = 18});

  final double radius;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final me = ref.watch(portalMeProvider);
    final url = ref.watch(portalProfileProvider).valueOrNull?.avatar.url;
    final iniciais = (me?.displayName ?? '?')
        .split(RegExp(r'\s+'))
        .where((parte) => parte.isNotEmpty)
        .take(2)
        .map((parte) => parte[0].toUpperCase())
        .join();
    return CircleAvatar(
      radius: radius,
      backgroundColor: palette.accentSoft,
      foregroundImage: url == null ? null : NetworkImage(url),
      child: Text(
        iniciais,
        style: OrbitType.label.copyWith(color: palette.accentStrong),
      ),
    );
  }
}

Future<void> showPortalProfileSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: context.orbit.background,
      builder: (_) => const _ProfileSheet(),
    );

class _ProfileSheet extends ConsumerStatefulWidget {
  const _ProfileSheet();

  @override
  ConsumerState<_ProfileSheet> createState() => _ProfileSheetState();
}

class _ProfileSheetState extends ConsumerState<_ProfileSheet> {
  bool _ocupado = false;

  Future<void> _executar(
    Future<PortalProfile> Function() acao,
    String falha,
  ) async {
    setState(() => _ocupado = true);
    try {
      await acao();
      ref.invalidate(portalProfileProvider);
    } on Object catch (error) {
      _avisar(OrbitException.publicCopyForAny(error, prefixo: falha));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _trocarFoto(ImageSource origem) async {
    try {
      final arquivo = await ref
          .read(avatarImagePickerProvider)
          .pickImage(
            source: origem,
            maxWidth: 1024,
            maxHeight: 1024,
            imageQuality: 85,
          );
      if (arquivo == null || !mounted) return;
      final original = await arquivo.readAsBytes();
      if (!mounted) return;
      final recortada = await showAvatarCropSheet(context, bytes: original);
      if (recortada == null || !mounted) return;
      final tipo = detectMimeType(recortada);
      if (tipo == null) {
        _avisar('Não foi possível preparar a imagem.');
        return;
      }
      await _executar(
        () => ref
            .read(portalRepositoryProvider)
            .setAvatar(recortada, mimeType: tipo),
        'Não foi possível trocar a foto.',
      );
    } on PlatformException catch (error) {
      final negado =
          error.code.contains('denied') || error.code.contains('restricted');
      _avisar(
        negado
            ? 'Não foi possível acessar ${origem == ImageSource.camera ? 'a câmera' : 'suas fotos'}. Confira as permissões nas configurações do aparelho.'
            : 'Não foi possível selecionar a foto. Tente novamente.',
      );
    }
  }

  Future<void> _escolherOrigemDaFoto() async {
    final origem = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Escolher da galeria'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Tirar foto'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (origem != null) await _trocarFoto(origem);
  }

  Future<void> _cadastrarAssinatura() async {
    final png = await Navigator.of(context).push<Uint8List>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => const PortalSignatureCaptureScreen(),
      ),
    );
    if (png == null || !mounted) return;
    await _executar(
      () => ref.read(portalRepositoryProvider).setSignature(png),
      'Não foi possível salvar a assinatura.',
    );
  }

  Future<void> _sair() async {
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sair da sua conta?'),
        content: const Text(
          'Para entrar de novo, use o mesmo e-mail e a sua senha.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sair'),
          ),
        ],
      ),
    );
    if (confirmado != true || !mounted) return;
    Navigator.of(context).pop();
    await ref.read(portalSessionProvider.notifier).logout();
  }

  void _avisar(String mensagem) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(mensagem)));
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final me = ref.watch(portalMeProvider);
    final perfil = ref.watch(portalProfileProvider);
    final dados = perfil.valueOrNull ?? PortalProfile.empty;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PortalCard(
            child: Column(
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const PortalAvatar(radius: 40),
                    Positioned(
                      right: -6,
                      bottom: -2,
                      child: Tooltip(
                        message: dados.avatar.available
                            ? 'Trocar foto'
                            : 'Adicionar foto',
                        child: Material(
                          color: palette.accent,
                          shape: CircleBorder(
                            side: BorderSide(color: palette.surface, width: 2),
                          ),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: _ocupado ? null : _escolherOrigemDaFoto,
                            child: const SizedBox(
                              width: 30,
                              height: 30,
                              child: Icon(
                                Icons.photo_camera_outlined,
                                color: Colors.white,
                                size: 16,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: OrbitSpacing.ms),
                Text(
                  me?.displayName ?? '',
                  textAlign: TextAlign.center,
                  style: OrbitType.sectionTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: 2),
                Text(
                  me?.email ?? '',
                  textAlign: TextAlign.center,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                Text(
                  'Cliente de ${me?.organizationName ?? ''}',
                  textAlign: TextAlign.center,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                if (dados.avatar.available)
                  TextButton(
                    onPressed: _ocupado
                        ? null
                        : () => _executar(
                            ref.read(portalRepositoryProvider).removeAvatar,
                            'Não foi possível remover a foto.',
                          ),
                    child: const Text('Remover foto'),
                  ),
              ],
            ),
          ),
          const PortalBlockTitle('Assinatura digital'),
          PortalCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _QuadroDaAssinatura(
                  carregando: perfil.isLoading && perfil.valueOrNull == null,
                  assinatura: dados.signature,
                ),
                const SizedBox(height: OrbitSpacing.ms),
                Text(
                  dados.signature.available
                      ? 'Esta é a assinatura guardada na sua conta. Em breve você poderá usá-la para assinar documentos pelo app.'
                      : 'Cadastre sua assinatura para tê-la guardada na conta. Em breve você poderá usá-la para assinar documentos pelo app.',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                const SizedBox(height: OrbitSpacing.md),
                OutlinedButton.icon(
                  onPressed: _ocupado ? null : _cadastrarAssinatura,
                  icon: const Icon(Icons.draw_outlined),
                  label: Text(
                    dados.signature.available
                        ? 'Refazer assinatura'
                        : 'Cadastrar assinatura',
                  ),
                ),
                if (dados.signature.available)
                  TextButton(
                    onPressed: _ocupado
                        ? null
                        : () => _executar(
                            ref.read(portalRepositoryProvider).removeSignature,
                            'Não foi possível remover a assinatura.',
                          ),
                    child: Text(
                      'Remover assinatura',
                      style: TextStyle(color: palette.danger),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: OrbitSpacing.lg),
          const LegalDocumentsGroup(),
          const SizedBox(height: OrbitSpacing.lg),
          OrbitSettingsGroup(
            title: 'Conta',
            children: [
              OrbitSettingsRow(
                icon: Icons.lock_outline,
                label: 'Trocar senha',
                onTap: _ocupado
                    ? null
                    : () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) =>
                              const PortalChangePasswordScreen(required: false),
                        ),
                      ),
              ),
              OrbitSettingsRow(
                icon: Icons.logout_rounded,
                label: 'Sair da conta',
                tone: palette.danger,
                onTap: _ocupado ? null : _sair,
              ),
            ],
          ),
          if (_ocupado) ...[
            const SizedBox(height: OrbitSpacing.md),
            const LinearProgressIndicator(),
          ],
        ],
      ),
    );
  }
}

/// A assinatura cadastrada, como vai aparecer num documento: traço escuro
/// sobre fundo branco. Sem assinatura, o espaço vazio diz isso.
class _QuadroDaAssinatura extends StatelessWidget {
  const _QuadroDaAssinatura({
    required this.carregando,
    required this.assinatura,
  });

  final bool carregando;
  final PortalMedia assinatura;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final url = assinatura.url;
    return Container(
      height: 128,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: OrbitRadius.field,
        border: Border.all(color: palette.border),
      ),
      padding: const EdgeInsets.all(OrbitSpacing.sm),
      alignment: Alignment.center,
      child: carregando
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : url != null
          ? Image.network(
              url,
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => Text(
                'Não foi possível mostrar a assinatura agora.',
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.draw_outlined, color: palette.inkSubtle),
                const SizedBox(height: OrbitSpacing.xs),
                Text(
                  assinatura.available
                      ? 'Assinatura cadastrada'
                      : 'Nenhuma assinatura cadastrada',
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
              ],
            ),
    );
  }
}

/// O quadro de assinatura em tela cheia — devolve o PNG ou `null`.
class PortalSignatureCaptureScreen extends StatefulWidget {
  const PortalSignatureCaptureScreen({super.key});

  @override
  State<PortalSignatureCaptureScreen> createState() =>
      _PortalSignatureCaptureScreenState();
}

class _PortalSignatureCaptureScreenState
    extends State<PortalSignatureCaptureScreen> {
  final _controle = OrbitSignatureController();
  bool _exportando = false;

  @override
  void dispose() {
    _controle.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    setState(() => _exportando = true);
    final png = await _controle.exportar();
    if (!mounted) return;
    setState(() => _exportando = false);
    if (png == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Desenhe a assinatura antes de salvar.')),
      );
      return;
    }
    Navigator.of(context).pop(png);
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Scaffold(
      appBar: AppBar(title: const Text('Sua assinatura')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Assine como assina no papel. Use o dedo, com calma — dá para limpar e refazer.',
                style: OrbitType.body.copyWith(color: palette.inkMuted),
              ),
              const SizedBox(height: OrbitSpacing.md),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, limites) => Align(
                    alignment: Alignment.topCenter,
                    child: OrbitSignaturePad(
                      controller: _controle,
                      hint: 'Assine neste espaço',
                      height: limites.maxHeight.clamp(180.0, 440.0),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: OrbitSpacing.md),
              /* Um embaixo do outro, em largura total: os botões do tema têm
                 largura mínima infinita, e numa `Row` sem `Expanded` a linha
                 inteira não era desenhada — era assim que o "Salvar" sumia. */
              ListenableBuilder(
                listenable: _controle,
                builder: (context, _) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    FilledButton.icon(
                      key: const Key('portal.signature.save'),
                      onPressed: _controle.temTraco && !_exportando
                          ? _salvar
                          : null,
                      icon: _exportando
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: const Text('Salvar assinatura'),
                    ),
                    const SizedBox(height: OrbitSpacing.xs),
                    TextButton.icon(
                      key: const Key('portal.signature.clear'),
                      onPressed: _controle.temTraco && !_exportando
                          ? _controle.limpar
                          : null,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Limpar e refazer'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Trocar a senha. `required`: a senha temporária ainda não foi trocada, e o
/// app não libera nada antes disso.
class PortalChangePasswordScreen extends ConsumerStatefulWidget {
  const PortalChangePasswordScreen({super.key, this.required = true});

  final bool required;

  @override
  ConsumerState<PortalChangePasswordScreen> createState() =>
      _PortalChangePasswordScreenState();
}

class _PortalChangePasswordScreenState
    extends ConsumerState<PortalChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _atual = TextEditingController();
  final _nova = TextEditingController();
  final _confirmacao = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _atual.dispose();
    _nova.dispose();
    _confirmacao.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ref
          .read(portalSessionProvider.notifier)
          .changePassword(
            currentPassword: _atual.text,
            newPassword: _nova.text,
          );
      if (!mounted) return;
      if (!widget.required) {
        Navigator.of(context).pop();
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(const SnackBar(content: Text('Senha trocada.')));
      }
    } on OrbitException catch (error) {
      if (!mounted) return;
      setState(
        () => _erro = error.isUnauthorized
            ? 'A senha atual não confere.'
            : error.publicMessage,
      );
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final me = ref.watch(portalMeProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.required ? 'Crie sua senha' : 'Trocar senha'),
        automaticallyImplyLeading: !widget.required,
        actions: [
          if (widget.required)
            TextButton(
              onPressed: () =>
                  ref.read(portalSessionProvider.notifier).logout(),
              child: const Text('Sair'),
            ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.required) ...[
                  Text(
                    'Bem-vindo${me == null ? '' : ', ${me.displayName}'}.',
                    style: OrbitType.sectionTitle.copyWith(color: palette.ink),
                  ),
                  const SizedBox(height: OrbitSpacing.xs),
                  Text(
                    'Você entrou com a senha temporária que ${me?.organizationName ?? 'a empresa'} passou. Crie agora a sua senha — só você vai saber qual é.',
                    style: OrbitType.body.copyWith(color: palette.inkMuted),
                  ),
                  const SizedBox(height: OrbitSpacing.lg),
                ],
                TextFormField(
                  controller: _atual,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: widget.required
                        ? 'Senha temporária'
                        : 'Senha atual',
                    prefixIcon: const Icon(Icons.lock_clock_outlined),
                  ),
                  validator: (valor) => (valor == null || valor.isEmpty)
                      ? 'Informe a senha ${widget.required ? 'temporária' : 'atual'}'
                      : null,
                ),
                const SizedBox(height: OrbitSpacing.md),
                TextFormField(
                  controller: _nova,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Nova senha',
                    helperText: 'No mínimo 12 caracteres.',
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                  validator: (valor) => (valor == null || valor.length < 12)
                      ? 'Use no mínimo 12 caracteres'
                      : valor == _atual.text
                      ? 'A nova senha precisa ser diferente da atual'
                      : null,
                ),
                const SizedBox(height: OrbitSpacing.md),
                TextFormField(
                  controller: _confirmacao,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Confirme a nova senha',
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                  validator: (valor) =>
                      valor != _nova.text ? 'As senhas não conferem' : null,
                ),
                if (_erro != null) ...[
                  const SizedBox(height: OrbitSpacing.md),
                  Text(_erro!, style: TextStyle(color: palette.danger)),
                ],
                const SizedBox(height: OrbitSpacing.lg),
                FilledButton(
                  onPressed: _enviando ? null : _salvar,
                  child: _enviando
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.2),
                        )
                      : const Text('Salvar senha'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
