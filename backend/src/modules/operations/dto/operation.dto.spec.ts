import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOperationDto, UpdateOperationDto } from './operation.dto';

describe('operation manual amount contract', () => {
  it('aceita vários checklists, mas recusa duplicatas, ids inválidos e mais de vinte modelos', async () => {
    const templateId = '01900000-0000-7000-8000-000000000002';
    const base = {
      businessUnitId: '01900000-0000-7000-8000-000000000001',
      code: 'OS-1',
      title: 'Visita',
      kind: 'MAINTENANCE',
    };
    expect(
      await validate(
        plainToInstance(CreateOperationDto, {
          ...base,
          checklists: [{ templateId }],
        }),
      ),
    ).toEqual([]);
    for (const checklists of [
      [{ templateId }, { templateId }],
      [{ templateId: 'invalid' }],
      Array.from({ length: 21 }, () => ({ templateId })),
    ]) {
      const errors = await validate(
        plainToInstance(CreateOperationDto, { ...base, checklists }),
      );
      expect(errors.some((error) => error.property === 'checklists')).toBe(
        true,
      );
    }
  });
  it.each([undefined, null, 0, 0.01, 1250.5, 999999999999.99])(
    'accepts an optional nonnegative amount %s',
    async (manualAmount) => {
      const dto = plainToInstance(CreateOperationDto, {
        businessUnitId: '01900000-0000-7000-8000-000000000001',
        code: 'OS-1',
        title: 'Visita',
        kind: 'MAINTENANCE',
        manualAmount,
      });
      expect(
        (await validate(dto)).filter(
          (error) => error.property === 'manualAmount',
        ),
      ).toEqual([]);
    },
  );
  it.each([-1, 1.001, 1000000000000, NaN, Infinity, '10.00'])(
    'rejects invalid amounts %s on create and update',
    async (manualAmount) => {
      for (const dto of [
        plainToInstance(CreateOperationDto, { manualAmount }),
        plainToInstance(UpdateOperationDto, { manualAmount }),
      ])
        expect(
          (await validate(dto)).some(
            (error) => error.property === 'manualAmount',
          ),
        ).toBe(true);
    },
  );
  it('accepts null to remove the override in PATCH', async () => {
    expect(
      await validate(
        plainToInstance(UpdateOperationDto, { manualAmount: null }),
      ),
    ).toEqual([]);
  });
});
