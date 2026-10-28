/* Métodos são inspecionados pelo Reflector, nunca chamados sem instância. */
/* eslint-disable @typescript-eslint/unbound-method */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SurfaceGuard } from './foundation.guards';
import { RvtController } from '../modules/rvt/rvt.controller';
import { PmocController } from '../modules/pmoc/pmoc.controller';

function mobileContext(
  controller: typeof RvtController | typeof PmocController,
  handler: unknown,
) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ user: { allowedSurfaces: ['MOBILE'] } }),
    }),
  } as unknown as ExecutionContext;
}

describe('rotas dos atendimentos atribuídos para usuários exclusivos do mobile', () => {
  const guard = new SurfaceGuard(new Reflector());
  it.each([
    RvtController.prototype.preparation,
    RvtController.prototype.start,
    RvtController.prototype.execution,
    RvtController.prototype.complete,
  ])('permite a superfície MOBILE no fluxo RVT: %p', (handler) => {
    expect(guard.canActivate(mobileContext(RvtController, handler))).toBe(true);
  });
  it.each([
    PmocController.prototype.equipmentExecutionPreparation,
    PmocController.prototype.startMyEquipmentExecution,
    PmocController.prototype.saveEquipmentWork,
    PmocController.prototype.completeMyEquipmentExecution,
    PmocController.prototype.generateMyEquipmentArtifact,
  ])('permite a superfície MOBILE no fluxo PMOC: %p', (handler) => {
    expect(guard.canActivate(mobileContext(PmocController, handler))).toBe(
      true,
    );
  });
  it('mantém as rotas de gestão de contratos fora do acesso exclusivo do aplicativo', () => {
    expect(() =>
      guard.canActivate(
        mobileContext(RvtController, RvtController.prototype.create),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        mobileContext(PmocController, PmocController.prototype.create),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        mobileContext(
          PmocController,
          PmocController.prototype.startEquipmentExecution,
        ),
      ),
    ).toThrow();
  });
});
