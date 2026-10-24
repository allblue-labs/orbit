export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/;

export const PASSWORD_POLICY_MESSAGE =
  'Password must include a lowercase letter, an uppercase letter, a number and a special character';
