/// Os termos do PMOC em português, num lugar só.
///
/// ## Por que traduzir, e por que aqui
///
/// Os códigos vêm do servidor — `PLAN_NOT_ACTIVE`, `NOT_STARTED` — e são a
/// autoridade. A tela traduz e **não** recalcula: decifrar o sistema não é
/// tarefa de quem está de pé numa casa de máquinas.
///
/// As frases são as mesmas da web (`registry/pmoc.ts`) de propósito: o técnico e
/// o dono falam do mesmo bloqueio quando ligam um para o outro.
library;

import '../../../core/design/orbit_primitives.dart';

/// O motivo do bloqueio, em frase.
///
/// Devolve o próprio código quando não conhece: um texto genérico esconderia a
/// pista que faria alguém entender o que aconteceu.
String pmocBlockedReasonLabel(String reason) => switch (reason) {
  'PLAN_NOT_ACTIVE' => 'O plano não está ativo.',
  'CYCLE_NOT_PENDING' => 'Este ciclo já foi encerrado.',
  'EQUIPMENT_INACTIVE' => 'O equipamento está inativo no cadastro.',
  'TECHNICAL_RESPONSIBLE_MISSING' =>
    'O plano não tem Responsável Técnico definido.',
  'TECHNICAL_RESPONSIBLE_INELIGIBLE' =>
    'O Responsável Técnico do plano não está elegível para assinar.',
  'SIGNATURE_MISSING' =>
    'O Responsável Técnico ainda não cadastrou a assinatura.',
  'CREDENTIAL_MISSING' => 'O Responsável Técnico está sem registro profissional.',
  'CREDENTIAL_EXPIRED' => 'O registro profissional do Responsável Técnico venceu.',
  _ => reason,
};

/// A situação de um equipamento no ciclo.
({String label, OrbitTone tone}) pmocEquipmentStatus(String status) =>
    switch (status) {
      'NOT_STARTED' => (label: 'A atender', tone: OrbitTone.neutral),
      'IN_PROGRESS' => (label: 'Em andamento', tone: OrbitTone.info),
      'COMPLETED' => (label: 'Concluído', tone: OrbitTone.success),
      'CANCELLED' => (label: 'Cancelado', tone: OrbitTone.neutral),
      _ => (label: status, tone: OrbitTone.neutral),
    };

/// A situação de um ciclo do plano.
({String label, OrbitTone tone}) pmocCycleStatus(String status) =>
    switch (status) {
      'PENDING' => (label: 'Em aberto', tone: OrbitTone.info),
      'IN_PROGRESS' => (label: 'Em andamento', tone: OrbitTone.info),
      'COMPLETED' => (label: 'Concluído', tone: OrbitTone.success),
      'SKIPPED' => (label: 'Não realizado', tone: OrbitTone.warning),
      'CANCELLED' => (label: 'Cancelado', tone: OrbitTone.neutral),
      _ => (label: status, tone: OrbitTone.neutral),
    };

/// `2026-10-14` → `14/10/2026`.
///
/// Vencimento é **dia**, não instante: o servidor o decide no fuso da unidade, e
/// converter para o relógio do aparelho mudaria o dia perto da meia-noite — a
/// diferença entre "vence hoje" e "venceu ontem".
String pmocDueLabel(String? isoDate) {
  if (isoDate == null || isoDate.length < 10) return '—';
  final partes = isoDate.substring(0, 10).split('-');
  if (partes.length != 3) return isoDate;
  return '${partes[2]}/${partes[1]}/${partes[0]}';
}
