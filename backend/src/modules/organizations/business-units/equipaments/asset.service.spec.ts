import { AssetCategory, AssetIdentifierType } from '../../../../contracts';
import { ValidationException } from '../../../../exceptions';
import type { EntitlementService } from '../../../subscription-plans/entitlements';
import type { AssetRepository } from './asset.repository';
import { AssetService } from './asset.service';

/** Sem plano no caminho: estes testes são sobre validação, não sobre cota. */
const semCota = {
  guardAllocation: <T>(_o: string, _r: string, work: () => Promise<T>) =>
    work(),
} as unknown as EntitlementService;

describe('AssetService', () => {
  const repository = {
    findBusinessUnit: jest.fn(),
    findCustomer: jest.fn(),
    create: jest.fn(),
    findByIdentifier: jest.fn(),
  };
  const service = new AssetService(
    repository as unknown as AssetRepository,
    semCota,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findBusinessUnit.mockResolvedValue({ id: 'unit-id' });
  });

  /**
   * Tipo lido da máquina exige o valor lido.
   *
   * QR, série, NFC, barras, RFID: o conteúdo vem da etiqueta ou da plaqueta. Aceitar
   * o tipo sem o valor deixaria um equipamento dizendo "sou identificado por QR" sem
   * QR nenhum — e a busca por etiqueta nunca o encontraria.
   */
  it('requires identifier type and value together', async () => {
    /* Número de série é lido da máquina: sem o valor não há o que gravar, e
       inventá-lo seria inventar um fato sobre o equipamento do cliente. */
    await expect(
      service.create('organization-id', {
        businessUnitId: 'unit-id',
        category: AssetCategory.EQUIPMENT,
        name: 'Compressor',
        identifierType: AssetIdentifierType.SERIAL_NUMBER,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('QR sem valor é aceito — o sistema imprime a etiqueta', async () => {
    repository.create.mockResolvedValue({ id: 'asset-id' });

    await expect(
      service.create('organization-id', {
        businessUnitId: 'unit-id',
        category: AssetCategory.EQUIPMENT,
        name: 'Compressor',
        identifierType: AssetIdentifierType.QR_CODE,
      }),
    ).resolves.toBeDefined();
  });

  /**
   * O código interno é a exceção: a organização o atribui, e o sistema o gera.
   *
   * Antes isto era um 400 — escolher "código interno" e não digitar nada recusava o
   * cadastro. Era o motivo pelo qual ninguém usava o campo.
   */
  it('accepts an internal code without a value, to be generated', async () => {
    repository.create.mockResolvedValue({ id: 'asset-id' });

    await expect(
      service.create('organization-id', {
        businessUnitId: 'unit-id',
        category: AssetCategory.EQUIPMENT,
        name: 'Compressor',
        identifierType: AssetIdentifierType.INTERNAL_CODE,
      }),
    ).resolves.toMatchObject({ id: 'asset-id' });

    /* O serviço não gera: quem gera é a fronteira do repositório, na mesma
       transação da criação. Aqui só se garante que o cadastro passa. */
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('still refuses an identifier without saying what it is', async () => {
    /* Um texto sem tipo não diz se é série, QR ou etiqueta interna, e quem ler
       depois não tem como saber. */
    await expect(
      service.create('organization-id', {
        businessUnitId: 'unit-id',
        category: AssetCategory.EQUIPMENT,
        name: 'Compressor',
        identifier: 'TORRE-A-12',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('rejects a warranty ending before installation', async () => {
    await expect(
      service.create('organization-id', {
        businessUnitId: 'unit-id',
        category: AssetCategory.EQUIPMENT,
        name: 'Compressor',
        installationAt: new Date('2026-02-01'),
        warrantyUntil: new Date('2026-01-01'),
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('resolves a scanned identifier inside the tenant context', async () => {
    repository.findByIdentifier.mockResolvedValue({ id: 'asset-id' });
    await expect(
      service.resolve(' NFC-0001 ', 'organization-id'),
    ).resolves.toEqual({ id: 'asset-id' });
    expect(repository.findByIdentifier).toHaveBeenCalledWith(
      'NFC-0001',
      'organization-id',
    );
  });
});
