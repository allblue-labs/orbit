import { validate } from 'class-validator';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  RegisterOrganizationDto,
  ResetPasswordDto,
} from '../presentation/dto/identity.dto';
import { PASSWORD_POLICY_MESSAGE } from './password-policy';

describe('password policy', () => {
  const cases = [
    {
      name: 'registration',
      dto: RegisterOrganizationDto,
      field: 'password',
    },
    { name: 'invitation', dto: AcceptInvitationDto, field: 'password' },
    { name: 'recovery', dto: ResetPasswordDto, field: 'password' },
    { name: 'password change', dto: ChangePasswordDto, field: 'newPassword' },
  ];

  it.each(cases)('$name rejects missing complexity requirements', async ({
    dto: Dto,
    field,
  }) => {
    const input = Object.assign(new Dto(), { [field]: 'abcdefghijkl' });
    const errors = await validate(input);
    const passwordError = errors.find((error) => error.property === field);

    expect(passwordError?.constraints).toHaveProperty(
      'matches',
      PASSWORD_POLICY_MESSAGE,
    );
  });

  it.each(cases)('$name accepts a password meeting the policy', async ({
    dto: Dto,
    field,
  }) => {
    const input = Object.assign(new Dto(), {
      [field]: 'OrbitSeguro2026!',
    });
    const errors = await validate(input);
    const passwordError = errors.find((error) => error.property === field);

    expect(passwordError?.constraints).not.toHaveProperty('matches');
  });
});
