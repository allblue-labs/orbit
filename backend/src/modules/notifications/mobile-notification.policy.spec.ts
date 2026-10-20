import { MobileNotificationPolicy } from './mobile-notification.policy';

describe('MobileNotificationPolicy', () => {
  const policy = new MobileNotificationPolicy();
  const base = {
    organizationId: '01900000-0000-7000-8000-000000000001',
    businessUnitId: '01900000-0000-7000-8000-000000000002',
    recipientUserId: '01900000-0000-7000-8000-000000000003',
    factId: '01900000-0000-7000-8000-000000000004',
    resourceId: '01900000-0000-7000-8000-000000000005',
    correlationId: '01900000-0000-7000-8000-000000000006',
  };

  it('maps assignment to a server-controlled read-only deep link', () => {
    expect(policy.resolve({ ...base, type: 'WORK_ASSIGNED' })).toEqual({
      dedupeKey: `WORK_ASSIGNED:${base.factId}:${base.recipientUserId}`,
      title: 'Novo atendimento atribuído',
      body: 'Abra o Orbit para consultar os detalhes atualizados.',
      deepLink: `/field/work-items/OPERATION:${base.resourceId}`,
    });
  });

  it('uses privacy-safe copy without operational PII', () => {
    const resolved = policy.resolve({ ...base, type: 'ARTIFACT_AVAILABLE' });
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toMatch(/endereço|telefone|e-mail|cliente|valor/i);
    expect(resolved.deepLink).toBe(`/field/artifacts/${base.resourceId}`);
  });
});
