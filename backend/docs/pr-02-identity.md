# PR-02 Identity

## HTTP surface

- `POST /identity/login`
- `POST /identity/refresh`
- `POST /identity/logout`
- `POST /identity/password/forgot`
- `POST /identity/password/reset`
- `GET|PATCH /identity/me`
- `GET /identity/me/sessions`
- `DELETE /identity/me/sessions/:id`
- `POST /identity/me/mfa/enrollment`
- `POST /identity/me/mfa/enable`
- `DELETE /identity/me/mfa`
- `POST /identity/invitations`
- `POST /identity/invitations/accept`

Invitation creation requires `identity.invitations.create`.

## Security behavior

- Access tokens expire after 15 minutes.
- Refresh tokens are opaque, stored only as SHA-256 hashes, expire after 30
  days, and rotate on every refresh.
- Every authenticated request verifies both JWT claims and active session state.
- Five failed password attempts lock credentials for 15 minutes.
- Password reset revokes every active session.
- MFA secrets are encrypted with `ENCRYPTION_KEY`; recovery codes are Argon2id
  hashes and are consumed after use.
- Password recovery responses do not reveal whether an account exists.

## Token delivery integration

`TransactionalIdentityTokenDelivery` uses the shared Amazon SES `EmailService`
for welcome/verification, invitation and password reset messages. Tokens and
recipients never enter logs. Only `NODE_ENV=test` disables delivery automatically.
See `amazon-ses.md` for environment and deployment instructions.

## Database

The repository previously had no Prisma migrations. PR-02 adds a baseline
migration containing the current schema and the identity tables. Its SQL was
compared byte-for-byte with a fresh Prisma schema diff.

Local deployment was not executed because port 5432 was already occupied by a
PostgreSQL instance that could not be safely identified. Run `prisma migrate
deploy` only after confirming the target database.

## Atualização PR-07 — entrega assíncrona

O transporte central SES continua único. Os fluxos de identidade agora gravam
uma intenção cifrada na mesma transação do token/usuário/convite e o worker envia
após o commit. Consultar [amazon-ses.md](amazon-ses.md) para migração, estados,
limites das garantias e preflight. A resposta de recuperação permanece neutra.
