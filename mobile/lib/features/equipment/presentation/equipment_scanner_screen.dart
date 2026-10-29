/// Ler a etiqueta de um equipamento.
///
/// ## O que a etiqueta é, e o que ela não é
///
/// É uma **chave de busca**. Quem lê continua sendo quem está logado: o
/// servidor resolve o equipamento e responde de acordo com as permissões da
/// sessão. Ter o papel na mão não dá acesso a nada — e é por isso que esta
/// tela não guarda token, não o mostra e não o coloca em log.
///
/// ## Por que existe entrada manual
///
/// Casa de máquinas tem pouca luz, etiqueta velha descasca, e luva de raspa
/// não segura um celular firme. Quando a câmera não resolve, digitar o código
/// resolve — e é a diferença entre registrar a manutenção agora e registrar
/// de memória à noite.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/contracts/equipment_qr_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/equipment_qr_providers.dart';
import '../data/equipment_qr_repository.dart';

/// Como o leitor foi chamado.
///
/// Vai no `extra` da rota porque é configuração de abertura, não identidade:
/// o caminho `/etiqueta` é o mesmo nos dois modos, e transformá-lo em dois
/// caminhos só para carregar um booleano espalharia a decisão pelo roteador.
class EquipmentScannerRequest {
  const EquipmentScannerRequest({this.returnsToken = false});

  /// Lê o pedido do `extra` da rota.
  ///
  /// `extra` é `Object?` — qualquer coisa cabe ali, inclusive nada. Um valor
  /// inesperado tem de cair no modo padrão, e não derrubar a tela: um leitor
  /// que abre errado é recuperável, um que não abre não é.
  factory EquipmentScannerRequest.fromExtra(Object? extra) =>
      extra is EquipmentScannerRequest
      ? extra
      : const EquipmentScannerRequest();

  final bool returnsToken;
}

class EquipmentScannerScreen extends ConsumerStatefulWidget {
  const EquipmentScannerScreen({super.key, this.returnsToken = false});

  /// Devolver o token em vez de mostrar o resultado aqui.
  ///
  /// Disponível para fluxos que precisam apenas escolher um equipamento.
  ///
  /// Quando `false`, resolve e abre a ficha na própria tela. A Home usa este
  /// modo para não perder a leitura quando seus dados são recarregados.
  final bool returnsToken;

  @override
  ConsumerState<EquipmentScannerScreen> createState() =>
      _EquipmentScannerScreenState();
}

class _EquipmentScannerScreenState
    extends ConsumerState<EquipmentScannerScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );

  /// O token lido. Enquanto houver um, a câmera para de decidir: duas leituras
  /// seguidas do mesmo papel abririam duas folhas empilhadas.
  String? _token;

  /// O que foi lido e não era etiqueta do Orbit. Vale dizer — o contrário é a
  /// pessoa mirando a mesma etiqueta errada pela quinta vez.
  bool _naoReconhecido = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _aoDetectar(BarcodeCapture captura) {
    if (_token != null) return;
    for (final codigo in captura.barcodes) {
      final valor = codigo.rawValue;
      if (valor == null) continue;
      final token = equipmentQrToken(valor);
      if (token != null) {
        _aceitar(token);
        return;
      }
    }
    if (!_naoReconhecido) setState(() => _naoReconhecido = true);
  }

  void _aceitar(String token) {
    if (_token != null || !mounted) return;
    // Trava antes de navegar: várias detecções no mesmo frame não podem
    // remover duas rotas nem perder o resultado da leitura.
    setState(() {
      _token = token;
      _naoReconhecido = false;
    });
    unawaited(_controller.stop());
    if (widget.returnsToken) context.pop(token);
  }

  void _limpar() => setState(() {
    _token = null;
    _naoReconhecido = false;
  });

  @override
  Widget build(BuildContext context) {
    final token = _token;

    return Scaffold(
      backgroundColor: token == null ? Colors.black : context.orbit.background,
      appBar: AppBar(
        title: Text(token == null ? 'Ler etiqueta' : 'Equipamento'),
        actions: token != null
            ? null
            : [
                IconButton(
                  onPressed: () => _controller.toggleTorch(),
                  icon: const Icon(Icons.flashlight_on_outlined),
                  tooltip: 'Lanterna',
                ),
              ],
      ),
      // Retirar o MobileScanner da árvore encerra a câmera. A ficha usa a
      // tela inteira e não pode ser coberta por uma nova leitura.
      body: token != null
          ? _Resultado(key: ValueKey(token), token: token, onFechar: _limpar)
          : Column(
              children: [
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      MobileScanner(
                        controller: _controller,
                        onDetect: _aoDetectar,
                        errorBuilder: (context, error) =>
                            _CameraIndisponivel(error: error),
                      ),
                      const _Mira(),
                      if (_naoReconhecido && token == null)
                        const Align(
                          alignment: Alignment.bottomCenter,
                          child: _Aviso(
                            texto: 'Este código não é uma etiqueta do Orbit.',
                          ),
                        ),
                    ],
                  ),
                ),

                _EntradaManualBotao(onRead: _aceitar),
              ],
            ),
    );
  }
}

/// Um quadro de mira. Não desenha regra nenhuma — orienta o enquadramento.
class _Mira extends StatelessWidget {
  const _Mira();

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Center(
      child: Container(
        width: 220,
        height: 220,
        decoration: BoxDecoration(
          border: Border.all(color: Colors.white70, width: 2),
          borderRadius: OrbitRadius.card,
        ),
      ),
    ),
  );
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.texto});

  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(OrbitSpacing.gutter),
    child: Container(
      padding: const EdgeInsets.symmetric(
        horizontal: OrbitSpacing.gutter,
        vertical: OrbitSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.7),
        borderRadius: OrbitRadius.pill,
      ),
      child: Text(texto, style: const TextStyle(color: Colors.white)),
    ),
  );
}

class _CameraIndisponivel extends StatelessWidget {
  const _CameraIndisponivel({required this.error});

  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    /// A permissão negada é a causa comum, e ela tem conserto do lado de quem
    /// lê — as outras não. Dizer qual é evita a viagem até o suporte.
    final semPermissao =
        error.errorCode == MobileScannerErrorCode.permissionDenied;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(OrbitSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.no_photography_outlined, color: Colors.white70),
            const SizedBox(height: OrbitSpacing.ms),
            Text(
              semPermissao
                  ? 'O Orbit precisa da câmera para ler a etiqueta. '
                        'Autorize nas configurações do aparelho.'
                  : 'Não foi possível abrir a câmera neste aparelho.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
          ],
        ),
      ),
    );
  }
}

/// Abre a digitação do código quando a câmera não resolve.
class _EntradaManualBotao extends StatelessWidget {
  const _EntradaManualBotao({required this.onRead});

  final ValueChanged<String> onRead;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: context.orbit.background,
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(OrbitSpacing.gutter),
        child: TextButton.icon(
          onPressed: () => showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (sheetContext) => EquipmentManualEntrySheet(
              onRead: (token) {
                Navigator.of(sheetContext).pop();
                onRead(token);
              },
            ),
          ),
          icon: const Icon(Icons.keyboard_alt_outlined, size: 18),
          label: const Text('Digitar o código da etiqueta'),
        ),
      ),
    ),
  );
}

/// Digitar o código, para quando a câmera não resolve.
class EquipmentManualEntrySheet extends ConsumerStatefulWidget {
  const EquipmentManualEntrySheet({super.key, this.onRead});

  final ValueChanged<String>? onRead;

  @override
  ConsumerState<EquipmentManualEntrySheet> createState() =>
      _EquipmentManualEntrySheetState();
}

class _EquipmentManualEntrySheetState
    extends ConsumerState<EquipmentManualEntrySheet> {
  final _campo = TextEditingController();
  String? _token;
  bool _invalido = false;

  @override
  void dispose() {
    _campo.dispose();
    super.dispose();
  }

  void _confirmar() {
    final token = equipmentQrToken(_campo.text);
    if (token != null && widget.onRead != null) {
      widget.onRead!(token);
      return;
    }
    setState(() {
      _token = token;
      _invalido = token == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final token = _token;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: OrbitSpacing.md,
          right: OrbitSpacing.md,
          top: OrbitSpacing.md,
          bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.md,
        ),
        child: token != null
            ? SizedBox(
                height: 360,
                child: _Resultado(
                  token: token,
                  onFechar: () => setState(() => _token = null),
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Código da etiqueta',
                    style: OrbitType.sectionTitle.copyWith(
                      color: context.orbit.ink,
                    ),
                  ),
                  const SizedBox(height: OrbitSpacing.sm),
                  TextField(
                    controller: _campo,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: 'Cole o endereço ou digite o código',
                      errorText: _invalido
                          ? 'Este código não é uma etiqueta do Orbit.'
                          : null,
                    ),
                    onSubmitted: (_) => _confirmar(),
                  ),
                  const SizedBox(height: OrbitSpacing.md),
                  FilledButton(
                    onPressed: _confirmar,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 48),
                    ),
                    child: const Text('Buscar equipamento'),
                  ),
                ],
              ),
      ),
    );
  }
}

/// O equipamento que a etiqueta identificou.
/// Abre o equipamento lido numa folha, por cima de onde a pessoa estava.
///
/// Existe para a tela inicial: de lá, ler etiqueta é uma consulta rápida —
/// "que equipamento é este?" — e mandar a pessoa para outra tela, com botão de
/// voltar, é atrito para uma pergunta de dois segundos.
Future<void> showEquipmentSheet(BuildContext context, String token) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.62,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (context, scrollController) => _Resultado(
        token: token,
        onFechar: () => Navigator.of(context).pop(),
        scrollController: scrollController,
      ),
    ),
  );
}

class _Resultado extends ConsumerWidget {
  const _Resultado({
    super.key,
    required this.token,
    required this.onFechar,
    this.scrollController,
  });

  final String token;
  final VoidCallback onFechar;

  /// Dado pela folha arrastável, para o gesto de arrastar e o de rolar serem
  /// o mesmo. Sem ele, puxar a lista para cima fecharia a folha.
  final ScrollController? scrollController;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final equipamento = ref.watch(equipmentByQrProvider(token));

    return ColoredBox(
      color: context.orbit.background,
      child: SafeArea(
        top: false,
        child: equipamento.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 4),
          ),
          error: (error, _) => ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () => ref.invalidate(equipmentByQrProvider(token)),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              TextButton(onPressed: onFechar, child: const Text('Ler outra')),
            ],
          ),
          data: (dados) => _Equipamento(
            token: token,
            equipment: dados,
            onFechar: onFechar,
            scrollController: scrollController,
          ),
        ),
      ),
    );
  }
}

class _Equipamento extends StatelessWidget {
  const _Equipamento({
    required this.token,
    required this.equipment,
    required this.onFechar,
    this.scrollController,
  });

  final EquipmentQrResolvedContract equipment;
  final String token;
  final VoidCallback onFechar;
  final ScrollController? scrollController;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final customer = equipment.customer;
    final contact = [
      customer?.contactName,
      customer?.contactPhone,
    ].whereType<String>().where((value) => value.trim().isNotEmpty).join('\n');

    return ListView(
      key: const ValueKey('equipment-details-scroll'),
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        OrbitSpacing.md,
        OrbitSpacing.gutter,
        OrbitSpacing.lg,
      ),
      children: [
        OrbitCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(OrbitSpacing.ms),
                    decoration: BoxDecoration(
                      color: palette.accentSoft,
                      borderRadius: OrbitRadius.field,
                    ),
                    child: Icon(
                      Icons.air_outlined,
                      color: palette.accent,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: OrbitSpacing.ms),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Equipamento identificado',
                          style: OrbitType.caption.copyWith(
                            color: palette.inkSubtle,
                          ),
                        ),
                        const SizedBox(height: OrbitSpacing.xs),
                        Text(
                          equipment.name,
                          style: OrbitType.screenTitle.copyWith(
                            color: palette.ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.md),
              Wrap(
                spacing: OrbitSpacing.sm,
                runSpacing: OrbitSpacing.sm,
                children: [
                  if (equipment.code.isNotEmpty)
                    OrbitStatusBadge(
                      label: equipment.code,
                      tone: OrbitTone.info,
                    ),
                  OrbitStatusBadge(
                    label: equipment.availability.active ? 'Ativo' : 'Inativo',
                    tone: equipment.availability.active
                        ? OrbitTone.success
                        : OrbitTone.neutral,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: OrbitSpacing.lg),
        _EquipmentSection(
          title: 'Identificação',
          icon: Icons.info_outline_rounded,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final columns =
                  constraints.maxWidth >= 280 &&
                      MediaQuery.textScalerOf(context).scale(1) <= 1.3
                  ? 2
                  : 1;
              return Wrap(
                spacing: OrbitSpacing.md,
                runSpacing: OrbitSpacing.md,
                children: [
                  for (final (index, field) in [
                    ('Fabricante', equipment.brand),
                    ('Modelo', equipment.model),
                    ('Número de série', equipment.serialNumber),
                  ].indexed)
                    SizedBox(
                      width: index == 2
                          ? constraints.maxWidth
                          : (constraints.maxWidth -
                                    OrbitSpacing.md * (columns - 1)) /
                                columns,
                      child: _EquipmentText(
                        label: field.$1,
                        text: field.$2?.trim().isNotEmpty == true
                            ? field.$2!
                            : 'Não informado',
                      ),
                    ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: OrbitSpacing.lg),
        _EquipmentSection(
          title: 'Cliente e instalação',
          icon: Icons.business_outlined,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _EquipmentInfo(
                icon: Icons.person_outline_rounded,
                label: 'Cliente',
                value: customer?.name ?? 'Sem cliente vinculado',
              ),
              const SizedBox(height: OrbitSpacing.md),
              _EquipmentInfo(
                icon: Icons.place_outlined,
                label: 'Local de instalação',
                value: equipment.serviceLocation?.trim().isNotEmpty == true
                    ? equipment.serviceLocation!
                    : 'Não informado',
              ),
              if (equipment.sector?.trim().isNotEmpty == true) ...[
                const SizedBox(height: OrbitSpacing.md),
                _EquipmentInfo(
                  icon: Icons.meeting_room_outlined,
                  label: 'Setor',
                  value: equipment.sector!,
                ),
              ],
              if (contact.isNotEmpty) ...[
                const SizedBox(height: OrbitSpacing.md),
                _EquipmentInfo(
                  icon: Icons.contact_phone_outlined,
                  label: 'Contato no local',
                  value: contact,
                ),
              ],
            ],
          ),
        ),
        if (equipment.lastService != null ||
            equipment.nextMaintenance != null) ...[
          const SizedBox(height: OrbitSpacing.lg),
          _EquipmentSection(
            title: 'Manutenção',
            icon: Icons.event_available_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (equipment.lastService case final last?)
                  _EquipmentInfo(
                    icon: Icons.check_circle_outline_rounded,
                    label: 'Último atendimento',
                    value:
                        '${OrbitFormat.of(context).dateHourOf(last.date)}\n${agendaEventTypeLabel(last.type) ?? 'Atendimento'}',
                  ),
                if (equipment.lastService != null &&
                    equipment.nextMaintenance != null)
                  const SizedBox(height: OrbitSpacing.md),
                if (equipment.nextMaintenance case final next?)
                  _EquipmentInfo(
                    icon: Icons.calendar_month_outlined,
                    label: 'Próxima manutenção',
                    value: OrbitFormat.of(context).dateHourOf(next),
                  ),
              ],
            ),
          ),
        ],
        if (equipment.allowedActions.contains(
          EquipmentFieldAction.viewHistory,
        )) ...[
          const SizedBox(height: OrbitSpacing.lg),
          _ServiceHistory(key: ValueKey(token), token: token),
        ],
        const SizedBox(height: OrbitSpacing.lg),
        OutlinedButton.icon(
          onPressed: onFechar,
          icon: const Icon(Icons.qr_code_scanner, size: 18),
          label: const Text('Ler outra etiqueta', textAlign: TextAlign.center),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.md,
              vertical: OrbitSpacing.md,
            ),
          ),
        ),
      ],
    );
  }
}

class _EquipmentSection extends StatelessWidget {
  const _EquipmentSection({
    required this.title,
    required this.icon,
    required this.child,
  });
  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) => OrbitCard(
    padding: const EdgeInsets.all(OrbitSpacing.md),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _EquipmentSectionHeading(title: title, icon: icon),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.md),
          child: Divider(height: 1, color: context.orbit.border),
        ),
        child,
      ],
    ),
  );
}

class _EquipmentSectionHeading extends StatelessWidget {
  const _EquipmentSectionHeading({required this.title, required this.icon});
  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 20, color: context.orbit.accent),
      const SizedBox(width: OrbitSpacing.sm),
      Expanded(
        child: Text(
          title,
          style: OrbitType.sectionTitle.copyWith(color: context.orbit.ink),
        ),
      ),
    ],
  );
}

class _EquipmentText extends StatelessWidget {
  const _EquipmentText({required this.label, required this.text});
  final String label;
  final String text;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
      ),
      const SizedBox(height: OrbitSpacing.xs),
      Text(
        text,
        style: OrbitType.body.copyWith(
          color: context.orbit.ink,
          fontWeight: FontWeight.w500,
        ),
      ),
    ],
  );
}

class _EquipmentInfo extends StatelessWidget {
  const _EquipmentInfo({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Icon(icon, size: 18, color: context.orbit.inkSubtle),
      ),
      const SizedBox(width: OrbitSpacing.ms),
      Expanded(
        child: _EquipmentText(label: label, text: value),
      ),
    ],
  );
}

class _ServiceHistory extends ConsumerStatefulWidget {
  const _ServiceHistory({super.key, required this.token});
  final String token;

  @override
  ConsumerState<_ServiceHistory> createState() => _ServiceHistoryState();
}

class _ServiceHistoryState extends ConsumerState<_ServiceHistory> {
  int _page = 1;

  @override
  Widget build(BuildContext context) {
    final request = (widget.token, _page);
    final history = ref.watch(equipmentServiceHistoryProvider(request));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _EquipmentSectionHeading(
          title: 'Histórico de atendimentos',
          icon: Icons.home_repair_service_outlined,
        ),
        const SizedBox(height: OrbitSpacing.sm),
        Text(
          'Serviços concluídos neste equipamento.',
          style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
        ),
        const SizedBox(height: OrbitSpacing.md),
        history.when(
          loading: () => const OrbitCard(child: SectionLoading(lines: 3)),
          error: (error, _) => OrbitCard(
            child: SectionError(
              error: error,
              onRetry: () =>
                  ref.invalidate(equipmentServiceHistoryProvider(request)),
            ),
          ),
          data: (data) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (data.items.isEmpty)
                OrbitCard(
                  child: Text(
                    'Nenhum atendimento concluído para este equipamento.',
                    style: OrbitType.body.copyWith(
                      color: context.orbit.inkMuted,
                    ),
                  ),
                ),
              for (final item in data.items) ...[
                _AttendanceCard(item: item),
                const SizedBox(height: OrbitSpacing.ms),
              ],
              if (data.totalPages > 1)
                OrbitCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: OrbitSpacing.sm,
                    vertical: OrbitSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        tooltip: 'Atendimentos mais recentes',
                        onPressed: _page > 1
                            ? () => setState(() => _page--)
                            : null,
                        icon: const Icon(Icons.chevron_left),
                      ),
                      Expanded(
                        child: Text(
                          'Página ${data.page} de ${data.totalPages}',
                          textAlign: TextAlign.center,
                          style: OrbitType.caption.copyWith(
                            color: context.orbit.inkMuted,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Atendimentos mais antigos',
                        onPressed: _page < data.totalPages
                            ? () => setState(() => _page++)
                            : null,
                        icon: const Icon(Icons.chevron_right),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({required this.item});
  final EquipmentServiceHistoryItem item;

  @override
  Widget build(BuildContext context) => OrbitCard(
    padding: const EdgeInsets.all(OrbitSpacing.md),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: OrbitSpacing.sm,
          runSpacing: OrbitSpacing.sm,
          children: [
            OrbitStatusBadge(
              label: agendaEventTypeLabel(item.type) ?? 'Ordem de serviço',
              tone: OrbitTone.info,
            ),
            const OrbitStatusBadge(label: 'Concluído', tone: OrbitTone.success),
          ],
        ),
        const SizedBox(height: OrbitSpacing.ms),
        Text(
          item.title,
          style: OrbitType.itemTitle.copyWith(color: context.orbit.ink),
        ),
        if (item.code.isNotEmpty) ...[
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            item.code,
            style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
          ),
        ],
        const SizedBox(height: OrbitSpacing.md),
        _EquipmentInfo(
          icon: Icons.event_available_outlined,
          label: 'Realizado em',
          value: OrbitFormat.of(context).dateHourOf(item.completedAt),
        ),
        if (item.technicianName?.trim().isNotEmpty == true) ...[
          const SizedBox(height: OrbitSpacing.ms),
          _EquipmentInfo(
            icon: Icons.engineering_outlined,
            label: 'Técnico em campo',
            value: item.technicianName!,
          ),
        ],
        if (item.description?.trim().isNotEmpty == true ||
            item.observations.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.md),
            child: Divider(height: 1, color: context.orbit.border),
          ),
          if (item.description?.trim().isNotEmpty == true)
            _EquipmentText(label: 'Descrição', text: item.description!),
          if (item.description?.trim().isNotEmpty == true &&
              item.observations.isNotEmpty)
            const SizedBox(height: OrbitSpacing.md),
          if (item.observations.isNotEmpty)
            Container(
              padding: const EdgeInsets.all(OrbitSpacing.ms),
              decoration: BoxDecoration(
                color: context.orbit.surfaceMuted,
                borderRadius: OrbitRadius.field,
              ),
              child: _EquipmentText(
                label: 'Observações do atendimento',
                text: item.observations.join('\n\n'),
              ),
            ),
        ] else ...[
          const SizedBox(height: OrbitSpacing.ms),
          Text(
            'Sem descrição ou observações registradas.',
            style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
          ),
        ],
      ],
    ),
  );
}
