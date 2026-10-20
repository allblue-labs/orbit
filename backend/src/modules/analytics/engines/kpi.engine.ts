import { Injectable } from '@nestjs/common';
import type { AnalyticsKpi, KpiReadModel } from '../analytics.read-models';
import {
  change,
  direction,
  percent,
  round,
  statusFor,
} from '../analytics.math';
import type { AnalyticsOperation, AnalyticsSnapshot } from '../analytics.types';

const COMPLETED = new Set([
  'COMPLETED',
  'DONE',
  'CLOSED',
  'FINALIZED',
  'PUBLISHED',
]);
const CANCELLED = new Set(['CANCELLED', 'CANCELED']);

@Injectable()
export class KpiEngine {
  execute(snapshot: AnalyticsSnapshot): KpiReadModel {
    const current = this.operationStats(snapshot.operations);
    const previous = this.operationStats(snapshot.previousOperations);
    const equipmentAvailable = snapshot.assets.filter(
      (asset) => asset.status === 'ACTIVE',
    ).length;
    const pmocCompleted = snapshot.pmocs.filter((report) =>
      COMPLETED.has(report.status),
    ).length;
    const assigned = snapshot.operations.filter(
      (operation) => operation.users.length > 0,
    );
    const activeCustomers = snapshot.customers.filter(
      (customer) => customer.status === 'ACTIVE',
    ).length;
    const samples = {
      OPERATIONS: snapshot.operations.length,
      PMOC: snapshot.pmocs.length,
      EQUIPMENT: snapshot.assets.length,
      TECHNICIANS: snapshot.operations.length,
      CONTRACTS: snapshot.customers.length,
      ENVIRONMENT: 0,
    };
    const indicators: AnalyticsKpi[] = [
      this.kpi(
        'operations.total',
        'OPERATIONS',
        'Operações criadas',
        current.total,
        undefined,
        change(current.total, previous.total),
        'operations',
        'OBSERVED',
      ),
      this.kpi(
        'operations.completion_rate',
        'OPERATIONS',
        'Taxa de conclusão',
        current.completionRate,
        '%',
        current.completionRate - previous.completionRate,
        'operations',
        'DERIVED',
        85,
        statusFor(current.completionRate, 75, 55),
      ),
      this.kpi(
        'operations.sla_compliance',
        'OPERATIONS',
        'SLA atendido',
        current.slaCompliance,
        '%',
        current.slaCompliance - previous.slaCompliance,
        'operations',
        'DERIVED',
        95,
        statusFor(current.slaCompliance, 85, 70),
      ),
      this.kpi(
        'pmoc.compliance',
        'PMOC',
        'Manutenções PMOC cumpridas',
        percent(pmocCompleted, snapshot.pmocs.length),
        '%',
        0,
        'pmoc_executions',
        'DERIVED',
        95,
        statusFor(percent(pmocCompleted, snapshot.pmocs.length), 85, 70),
      ),
      this.kpi(
        'equipment.availability',
        'EQUIPMENT',
        'Disponibilidade dos equipamentos',
        percent(equipmentAvailable, snapshot.assets.length),
        '%',
        0,
        'assets',
        'DERIVED',
        95,
        statusFor(percent(equipmentAvailable, snapshot.assets.length), 85, 70),
      ),
      this.kpi(
        'technicians.assignment_coverage',
        'TECHNICIANS',
        'Cobertura de atribuição técnica',
        percent(assigned.length, snapshot.operations.length),
        '%',
        0,
        'operation_users',
        'DERIVED',
        95,
        statusFor(percent(assigned.length, snapshot.operations.length), 80, 60),
      ),
      this.kpi(
        'technicians.active',
        'TECHNICIANS',
        'Técnicos alocados',
        new Set(assigned.flatMap((op) => op.users.map(({ user }) => user.id)))
          .size,
        undefined,
        0,
        'operation_users',
        'OBSERVED',
      ),
      this.kpi(
        'contracts.active_proxy',
        'CONTRACTS',
        'Contratos ativos (proxy)',
        activeCustomers,
        undefined,
        0,
        'customers',
        'PROXY',
      ),
    ];
    return {
      generatedAt: new Date().toISOString(),
      period: this.period(snapshot),
      availability: [],
      indicators: indicators.map((indicator) => ({
        ...indicator,
        sampleSize: samples[indicator.domain],
      })),
    };
  }

  private operationStats(operations: AnalyticsOperation[]) {
    const completed = operations.filter((op) => COMPLETED.has(op.status));
    const eligible = completed.filter(
      (op) => op.scheduledEnd && op.completedAt,
    );
    const withinSla = eligible.filter(
      (op) => op.completedAt! <= op.scheduledEnd!,
    ).length;
    return {
      total: operations.filter((op) => !CANCELLED.has(op.status)).length,
      completionRate: percent(completed.length, operations.length),
      slaCompliance: eligible.length ? percent(withinSla, eligible.length) : 0,
    };
  }

  private kpi(
    id: string,
    domain: AnalyticsKpi['domain'],
    label: string,
    value: number,
    unit: string | undefined,
    delta: number,
    source: string,
    dataQuality: AnalyticsKpi['dataQuality'],
    target?: number,
    status: AnalyticsKpi['status'] = 'HEALTHY',
  ): AnalyticsKpi {
    return {
      id,
      domain,
      label,
      value: round(value),
      unit,
      target,
      status,
      changePercent: round(delta),
      direction: direction(delta),
      source,
      dataQuality,
    };
  }

  private period(snapshot: AnalyticsSnapshot) {
    return {
      from: snapshot.range.from.toISOString(),
      to: snapshot.range.to.toISOString(),
      granularity: snapshot.range.granularity,
    };
  }
}
