/**
 * Os ritmos de manutenção que toda organização tem no primeiro dia.
 *
 * ## Por que vêm prontos
 *
 * Sem eles, a primeira visita técnica exigiria cadastrar um tipo antes — e
 * "Semanal, 7 dias" não é uma decisão que valha pedir a alguém. O catálogo é
 * editável: renomear, mudar a cadência e acrescentar "Quadrimestral" é cadastro,
 * não migração, que é justamente o que o literal de dois valores não permitia.
 *
 * ## Dias ou meses
 *
 * Dias para os ritmos curtos; meses para os que seguem o calendário. Somar 30
 * dias não é somar um mês, e quem contrata trimestral espera a visita no mesmo
 * dia do terceiro mês.
 */
export interface RvtMaintenanceTypeSeed {
  key: string;
  label: string;
  intervalDays: number | null;
  intervalMonths: number | null;
  sortOrder: number;
}

export const RVT_MAINTENANCE_TYPE_SEEDS: readonly RvtMaintenanceTypeSeed[] = [
  {
    key: 'WEEKLY',
    label: 'Semanal',
    intervalDays: 7,
    intervalMonths: null,
    sortOrder: 10,
  },
  {
    key: 'BIWEEKLY',
    label: 'Quinzenal',
    intervalDays: 14,
    intervalMonths: null,
    sortOrder: 20,
  },
  {
    key: 'MONTHLY',
    label: 'Mensal',
    intervalDays: null,
    intervalMonths: 1,
    sortOrder: 30,
  },
  {
    key: 'BIMONTHLY',
    label: 'Bimestral',
    intervalDays: null,
    intervalMonths: 2,
    sortOrder: 40,
  },
  {
    key: 'QUARTERLY',
    label: 'Trimestral',
    intervalDays: null,
    intervalMonths: 3,
    sortOrder: 50,
  },
  {
    key: 'SEMIANNUAL',
    label: 'Semestral',
    intervalDays: null,
    intervalMonths: 6,
    sortOrder: 60,
  },
  {
    key: 'ANNUAL',
    label: 'Anual',
    intervalDays: null,
    intervalMonths: 12,
    sortOrder: 70,
  },
];
