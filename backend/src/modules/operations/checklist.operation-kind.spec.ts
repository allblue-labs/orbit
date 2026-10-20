/**
 * Checklist por tipo de atendimento, e os itens extras da execução.
 *
 * ## O que se prova
 *
 * Que o modelo do dono da organização **não muda** quando um atendimento
 * pede uma verificação a mais: os extras vivem no snapshot da execução.
 * Sem isso, a primeira operação que precisasse de um item adicional
 * reescreveria o padrão de todas as seguintes.
 */
import { Prisma } from '@prisma/client';
import { ChecklistService } from './checklist.service';

const organizationId = '01900000-0000-7000-8000-000000000001';
const operationId = '01900000-0000-7000-8000-000000000002';
const templateId = '01900000-0000-7000-8000-000000000003';
const actorId = '01900000-0000-7000-8000-000000000004';

const itemDoModelo = {
  key: 'GAS',
  label: 'Pressão do gás',
  type: 'NUMBER',
  required: true,
};

function harness() {
  const template = {
    id: templateId,
    key: 'MANUTENCAO',
    name: 'Manutenção preventiva',
    version: 3,
    isActive: true,
    operationKind: 'MAINTENANCE',
    items: [itemDoModelo],
  };
  const createdInputs: Prisma.ChecklistExecutionUncheckedCreateInput[] = [];
  const repository = {
    findTemplate: jest.fn().mockResolvedValue(template),
    createExecution: jest.fn(
      (input: Prisma.ChecklistExecutionUncheckedCreateInput) => {
        createdInputs.push(input);
        return Promise.resolve(input);
      },
    ),
    listTemplates: jest.fn(),
  };
  const operations = {
    find: jest.fn().mockResolvedValue({
      id: operationId,
      businessUnitId: '01900000-0000-7000-8000-000000000009',
    }),
  };
  const service = new ChecklistService(
    repository as never,
    operations as never,
  );
  return { service, repository, template, createdInputs };
}

describe('execução de checklist', () => {
  it('sem extras, o snapshot é o do modelo', async () => {
    const { service, createdInputs } = harness();

    await service.start(operationId, organizationId, actorId, {
      templateId,
    });

    const input = createdInputs[0]!;
    const snapshot = input.templateSnapshot as { items: unknown[] };
    expect(snapshot.items).toEqual([itemDoModelo]);
    expect(input.templateVersion).toBe(3);
  });

  it('os extras entram ao lado dos herdados, nesta ordem', async () => {
    /// Herdados primeiro: quem responde em campo espera o roteiro conhecido
    /// antes do que foi pedido só para este atendimento.
    const { service, createdInputs } = harness();
    const extra = {
      key: 'EXTRA_VAZAMENTO',
      label: 'Conferir vazamento no duto novo',
      type: 'BOOLEAN',
    };

    await service.start(operationId, organizationId, actorId, {
      templateId,
      additionalItems: [extra],
    } as never);

    const snapshot = createdInputs[0]!.templateSnapshot as {
      items: unknown[];
    };
    expect(snapshot.items).toEqual([itemDoModelo, extra]);
  });

  it('o modelo não é reescrito para acomodar o extra', async () => {
    /// O objeto do modelo devolvido pelo repositório continua com um item
    /// só: o extra foi para o snapshot, não para o catálogo.
    const { service, template } = harness();

    await service.start(operationId, organizationId, actorId, {
      templateId,
      additionalItems: [{ key: 'X', label: 'X', type: 'TEXT' }],
    } as never);

    expect(template.items).toEqual([itemDoModelo]);
  });
});
