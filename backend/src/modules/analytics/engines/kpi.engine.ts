import { Injectable } from '@nestjs/common';
import type { AnalyticsKpi, KpiReadModel } from '../analytics.read-models';
import {
  change,
  direction,
  percent,
  round,
  statusFor,
} from '../analytics.math';
import type { AnalyticsSnapshot } from '../analytics.types';

@Injectable()
export class KpiEngine {
  execute(snapshot: AnalyticsSnapshot): KpiReadModel {
    const { range, operations, pmoc, rvt } = snapshot;
    const { current, previous: before } = operations;
    const indicators: AnalyticsKpi[] = [];
    const count = (
      id: string,
      domain: AnalyticsKpi['domain'],
      label: string,
      value: number,
      description: string,
      previous?: number,
      executive = true,
      alert = false,
    ) => {
      const delta =
        previous === undefined || previous === 0 ? 0 : change(value, previous);
      indicators.push({
        id,
        domain,
        label,
        value,
        source:
          domain === 'EQUIPMENT'
            ? 'assets'
            : domain === 'PMOC'
              ? 'pmoc_executions'
              : domain === 'RVT'
                ? 'rvt_occurrences'
                : 'operations',
        dataQuality: 'OBSERVED',
        sampleSize: value,
        description,
        executive,
        comparisonAvailable: previous !== undefined && previous > 0,
        status: alert && value > 0 ? 'ATTENTION' : 'HEALTHY',
        changePercent: delta,
        direction: direction(delta),
      });
    };
    const rate = (
      id: string,
      domain: AnalyticsKpi['domain'],
      label: string,
      numerator: number,
      denominator: number,
      oldNumerator: number,
      oldDenominator: number,
      description: string,
      executive = false,
    ) => {
      const value = percent(numerator, denominator);
      const delta =
        denominator && oldDenominator
          ? round(value - percent(oldNumerator, oldDenominator))
          : 0;
      indicators.push({
        id,
        domain,
        label,
        value,
        unit: '%',
        source:
          domain === 'EQUIPMENT'
            ? 'assets'
            : domain === 'PMOC'
              ? 'pmoc_executions'
              : domain === 'RVT'
                ? 'rvt_occurrences'
                : 'operations',
        dataQuality: 'DERIVED',
        sampleSize: denominator,
        basis: { numerator, denominator },
        description,
        executive,
        comparisonAvailable: denominator > 0 && oldDenominator > 0,
        changeUnit: 'POINTS',
        changePercent: delta,
        direction: direction(delta),
        status: statusFor(value, 90, 70),
      });
    };
    count(
      'operations.open',
      'OPERATIONS',
      'Atendimentos em aberto',
      operations.open,
      'Fila atual, incluindo demandas antigas.',
    );
    count(
      'operations.overdue',
      'OPERATIONS',
      'Atendimentos atrasados',
      operations.overdue,
      'Em aberto com término previsto já vencido.',
      undefined,
      true,
      true,
    );
    count(
      'operations.unassigned',
      'TECHNICIANS',
      'Sem técnico definido',
      operations.unassigned,
      'Em aberto e sem técnico operacional responsável.',
      undefined,
      true,
      true,
    );
    count(
      'operations.unscheduled',
      'OPERATIONS',
      'Sem agendamento',
      operations.unscheduled,
      'Em aberto e sem data de início prevista.',
      undefined,
      true,
      true,
    );
    count(
      'operations.completed',
      'OPERATIONS',
      'Concluídos no período',
      current.delivered,
      'Conclusões pela data de encerramento, inclusive demandas antigas.',
      before.delivered,
    );
    rate(
      'operations.sla_compliance',
      'OPERATIONS',
      'Concluídos no prazo',
      current.onTime,
      current.withDeadline,
      before.onTime,
      before.withDeadline,
      'Entre os atendimentos concluídos no período que tinham término previsto.',
      true,
    );
    count(
      'pmoc.overdue',
      'PMOC',
      'Ciclos PMOC pendentes',
      pmoc.current.overdue,
      'Ciclos vencidos e ainda não concluídos, incluindo anteriores ao período.',
      undefined,
      true,
      true,
    );
    count(
      'rvt.overdue',
      'RVT',
      'Visitas RVT pendentes',
      rvt.current.overdue,
      'Visitas vencidas e ainda não concluídas, incluindo anteriores ao período.',
      undefined,
      true,
      true,
    );
    rate(
      'operations.scheduling_coverage',
      'OPERATIONS',
      'Demandas com agenda',
      current.scheduled,
      current.cohort,
      before.scheduled,
      before.cohort,
      'Demandas criadas em cada período com início previsto; conforme cadastro atual.',
    );
    rate(
      'technicians.assignment_coverage',
      'TECHNICIANS',
      'Demandas com técnico',
      current.assigned,
      current.cohort,
      before.assigned,
      before.cohort,
      'Demandas criadas em cada período com técnico operacional responsável; auxiliares não substituem o responsável.',
    );
    rate(
      'pmoc.compliance',
      'PMOC',
      'PMOC em dia',
      pmoc.current.onTime,
      pmoc.current.total,
      pmoc.previous.onTime,
      pmoc.previous.total,
      'Ciclos vencidos no período e pendências anteriores; conclusão até o vencimento.',
    );
    rate(
      'rvt.compliance',
      'RVT',
      'RVT em dia',
      rvt.current.onTime,
      rvt.current.total,
      rvt.previous.onTime,
      rvt.previous.total,
      'Visitas com data vencida no período e pendências anteriores; conclusão até o fim do dia agendado.',
    );
    rate(
      'operations.backlog_punctuality',
      'OPERATIONS',
      'Fila dentro do prazo',
      operations.openWithDeadline - operations.overdue,
      operations.openWithDeadline,
      0,
      0,
      'Atendimentos em aberto com término previsto que ainda não venceram.',
    );
    rate(
      'operations.backlog_scheduling',
      'OPERATIONS',
      'Fila com agenda',
      operations.open - operations.unscheduled,
      operations.open,
      0,
      0,
      'Atendimentos em aberto com início previsto.',
    );
    rate(
      'technicians.backlog_coverage',
      'TECHNICIANS',
      'Fila com técnico',
      operations.open - operations.unassigned,
      operations.open,
      0,
      0,
      'Atendimentos em aberto com responsável operacional.',
    );
    count(
      'operations.total',
      'OPERATIONS',
      'Demandas criadas',
      current.cohort,
      'Criadas no período, excluindo canceladas.',
      before.cohort,
      false,
    );
    rate(
      'operations.completion_rate',
      'OPERATIONS',
      'Demandas do período concluídas',
      operations.completedCohort,
      current.cohort,
      0,
      0,
      'Conclusões entre as demandas criadas no próprio período; não mede produtividade.',
    );
    count(
      'technicians.active',
      'TECHNICIANS',
      'Técnicos responsáveis',
      operations.activeTechnicians,
      'Responsáveis distintos nas demandas criadas no período.',
      undefined,
      false,
    );
    count(
      'equipment.registered',
      'EQUIPMENT',
      'Equipamentos cadastrados',
      snapshot.equipmentRegistered,
      'Cadastro de equipamentos; não representa disponibilidade física.',
      undefined,
      false,
    );
    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        granularity: range.granularity,
      },
      availability: [],
      indicators,
    };
  }
}
