import { OrganizationController } from './organization.controller';

it('does not bypass subscription limits through the legacy tenant creation endpoint', async () => {
  const create = jest.fn();
  const controller = new OrganizationController(
    { create } as never,
    {} as never,
  );
  await expect(
    Promise.resolve().then(() =>
      controller.create(
        { identity: { id: 'owner', organizationId: 'account' } } as never,
        {} as never,
      ),
    ),
  ).rejects.toMatchObject({ code: 'REGISTRATION_USE_EXISTING_ACCOUNT' });
  expect(create).not.toHaveBeenCalled();
});
