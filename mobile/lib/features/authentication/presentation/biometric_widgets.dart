/// A biometria na tela: o interruptor das configurações, o convite depois do
/// primeiro login com senha e o botão do login.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_settings_list.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../application/biometric_login.dart';

/// Ativa ou desativa, com a mensagem certa para cada desfecho.
Future<void> toggleBiometric(
  BuildContext context,
  WidgetRef ref,
  BiometricAudience audience, {
  required bool enable,
}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final service = ref.read(biometricLoginProvider);
  try {
    if (!enable) {
      await service.disable(audience);
      messenger?.showSnackBar(
        const SnackBar(content: Text('Biometria desativada neste aparelho.')),
      );
      return;
    }
    final result = await service.enable(audience);
    if (result == BiometricEnableResult.enabled) {
      messenger?.showSnackBar(
        const SnackBar(
          content: Text('Biometria ativada. No próximo acesso, é só tocar.'),
        ),
      );
    }
  } on Object catch (error) {
    messenger?.showSnackBar(
      SnackBar(
        content: Text(
          OrbitException.publicCopyForAny(
            error,
            prefixo: 'Não foi possível ativar a biometria.',
          ),
        ),
      ),
    );
  }
}

/// "Entrar com biometria" — a linha de Configurações (equipe) e do perfil
/// (cliente). Some quando o aparelho não tem biometria.
class BiometricSettingsRow extends ConsumerStatefulWidget {
  const BiometricSettingsRow({super.key, required this.audience});

  final BiometricAudience audience;

  @override
  ConsumerState<BiometricSettingsRow> createState() =>
      _BiometricSettingsRowState();
}

class _BiometricSettingsRowState extends ConsumerState<BiometricSettingsRow> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final available = ref.watch(biometricAvailableProvider).valueOrNull;
    final enabled =
        ref.watch(biometricEnabledProvider(widget.audience)).valueOrNull ??
        false;
    final unsupported = available == false;
    return OrbitSettingsRow(
      key: const Key('biometric.settings'),
      icon: Icons.fingerprint_rounded,
      label: 'Entrar com biometria',
      description: unsupported
          ? 'Este aparelho não tem digital ou reconhecimento facial cadastrado.'
          : 'Digital ou rosto no lugar da senha, neste aparelho.',
      trailing: Switch.adaptive(
        value: enabled,
        onChanged: _busy || available != true
            ? null
            : (value) async {
                setState(() => _busy = true);
                await toggleBiometric(
                  context,
                  ref,
                  widget.audience,
                  enable: value,
                );
                if (mounted) setState(() => _busy = false);
              },
      ),
    );
  }
}

/// O convite, uma vez, logo depois de entrar com senha.
///
/// Mora no shell de cada público: aparece quando a pessoa chega à tela
/// inicial, e não no meio do login — e espera a troca de senha obrigatória,
/// que acontece antes do shell existir.
class BiometricOfferGate extends ConsumerStatefulWidget {
  const BiometricOfferGate({
    super.key,
    required this.audience,
    required this.settingsHint,
    required this.child,
  });

  final BiometricAudience audience;

  /// Onde ativar depois, dito no convite.
  final String settingsHint;
  final Widget child;

  @override
  ConsumerState<BiometricOfferGate> createState() => _BiometricOfferGateState();
}

class _BiometricOfferGateState extends ConsumerState<BiometricOfferGate> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeOffer());
  }

  Future<void> _maybeOffer() async {
    final service = ref.read(biometricLoginProvider);
    if (!await service.takeOffer(widget.audience) || !mounted) return;
    final accepted = await showBiometricOffer(
      context,
      settingsHint: widget.settingsHint,
    );
    if (!mounted) return;
    if (accepted == true) {
      await toggleBiometric(context, ref, widget.audience, enable: true);
    } else {
      await service.dismissOffer(widget.audience);
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// O diálogo do convite. `true` = ativar; `false`/`null` = agora não.
Future<bool?> showBiometricOffer(
  BuildContext context, {
  required String settingsHint,
}) => showDialog<bool>(
  context: context,
  barrierDismissible: false,
  builder: (context) {
    final palette = context.orbit;
    return AlertDialog(
      key: const Key('biometric.offer'),
      icon: Icon(Icons.fingerprint_rounded, size: 40, color: palette.accent),
      title: const Text('Entrar com biometria?'),
      content: Text(
        'Da próxima vez, entre com a digital ou o rosto, sem digitar a senha. '
        'A biometria fica no aparelho — o Orbit nunca a recebe.\n\n'
        'Se preferir, ative depois em $settingsHint.',
      ),
      actionsAlignment: MainAxisAlignment.center,
      actionsOverflowDirection: VerticalDirection.up,
      actions: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FilledButton(
              key: const Key('biometric.offer.accept'),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Ativar biometria'),
            ),
            const SizedBox(height: OrbitSpacing.xs),
            TextButton(
              key: const Key('biometric.offer.skip'),
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Agora não'),
            ),
          ],
        ),
      ],
    );
  },
);
