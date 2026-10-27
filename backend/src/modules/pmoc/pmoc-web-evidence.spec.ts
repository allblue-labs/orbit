import sharp from 'sharp';
import { PmocWebEvidenceController } from './pmoc-web-evidence.controller';
import { PmocRepository } from './pmoc.repository';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';

function setup(status: string | null = 'IN_PROGRESS', count = 0) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
    pmocEquipmentExecution: {
      findFirst: jest
        .fn()
        .mockResolvedValue(status ? { status, businessUnitId: 'unit' } : null),
    },
    pmocEquipmentEvidence: {
      count: jest.fn().mockResolvedValue(count),
      create: jest.fn().mockResolvedValue({ id: 'evidence' }),
    },
    fieldEvidence: { count: jest.fn().mockResolvedValue(1) },
  };
  const repository = new PmocRepository(
    { runAmbient: (work: (tx: unknown) => unknown) => work(tx) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const files = { storeWith: jest.fn().mockResolvedValue({ id: 'file' }) };
  const controller = new PmocWebEvidenceController(repository, files as never);
  const request = {
    identity: { id: 'actor', organizationId: 'org', businessUnitIds: ['unit'] },
  } as unknown as IdentityRequest;
  return { tx, files, controller, request };
}

describe('upload de imagens PMOC na web', () => {
  const image = () =>
    sharp({
      create: { width: 2, height: 2, channels: 3, background: '#156cdd' },
    })
      .png()
      .toBuffer();
  it('confere bytes e grava arquivo/evidência na mesma transação e unidade', async () => {
    const env = setup();
    const file = {
      buffer: await image(),
      originalname: 'filtro.png',
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    await expect(
      env.controller.upload(env.request, 'execution', file),
    ).resolves.toEqual({ id: 'evidence' });
    expect(env.files.storeWith).toHaveBeenCalledWith(
      env.tx,
      expect.objectContaining({
        organizationId: 'org',
        businessUnitId: 'unit',
        mimeType: 'image/png',
      }),
    );
    expect(env.tx.pmocEquipmentExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'execution',
          organizationId: 'org',
          businessUnitId: { in: ['unit'] },
        },
      }),
    );
    expect(env.tx.pmocEquipmentEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: 'org',
          kind: 'PHOTO',
          equipmentExecutionId: 'execution',
          storageFileId: 'file',
          uploadedById: 'actor',
        },
      }),
    );
  });
  it.each([null, 'COMPLETED'])(
    'não envia arquivo quando a execução está ausente/fechada: %s',
    async (status) => {
      const env = setup(status);
      await expect(
        env.controller.upload(env.request, 'execution', {
          buffer: await image(),
          originalname: 'foto.png',
        } as Express.Multer.File),
      ).rejects.toBeDefined();
      expect(env.files.storeWith).not.toHaveBeenCalled();
    },
  );
  it('considera também as fotos mobile no limite antes de armazenar outra', async () => {
    const env = setup('IN_PROGRESS', 5);
    await expect(
      env.controller.upload(env.request, 'execution', {
        buffer: await image(),
        originalname: 'foto.png',
      } as Express.Multer.File),
    ).rejects.toMatchObject({ code: 'EVIDENCE_LIMIT_REACHED' });
    expect(env.files.storeWith).not.toHaveBeenCalled();
  });
  it('recusa arquivo que só foi renomeado como imagem', async () => {
    const env = setup();
    await expect(
      env.controller.upload(env.request, 'execution', {
        buffer: Buffer.from('conteúdo de texto'),
        originalname: 'foto.png',
        mimetype: 'image/png',
      } as Express.Multer.File),
    ).rejects.toMatchObject({ code: 'FILE_INVALID' });
    expect(env.files.storeWith).not.toHaveBeenCalled();
  });
});
