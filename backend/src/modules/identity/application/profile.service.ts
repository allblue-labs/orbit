import { Inject, Injectable } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import {
  EntityNotFoundException,
  ValidationException,
} from '../../../exceptions';
import { HASH_PROVIDER } from '../../../providers';
import type { UpdateProfileDto } from '../presentation/dto/identity.dto';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { AvatarService } from './avatar.service';

@Injectable()
export class ProfileService {
  constructor(
    private readonly repository: IdentityRepository,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    private readonly avatars: AvatarService,
  ) {}

  /**
   * O perfil de quem está autenticado.
   *
   * ## `avatarUrl` é assinado na hora, e não lido de `users.avatar_url`
   *
   * Aquela coluna é resquício de quando a foto era um endereço solto. Hoje a
   * foto é um arquivo (`avatar_storage_file_id`) servido por URL assinada e
   * temporária — e uma URL que expira não cabe numa coluna persistida. O
   * resultado é que a coluna **nunca** é escrita: ficou nula para todo mundo,
   * inclusive para quem acabou de trocar a foto com sucesso.
   *
   * A web não sofria porque pede a foto a `/identity/me/avatar`, que a assina
   * na hora. O aplicativo lê `avatarUrl` do perfil, recebia nulo e mostrava as
   * iniciais — a foto ficava gravada e invisível.
   *
   * Publicar aqui o mesmo endereço que aquele endpoint emite mantém uma fonte
   * só — o arquivo — e faz o campo parar de mentir.
   */
  async get(userId: string, organizationId: string) {
    const user = await this.requireUser(userId);
    const avatar = await this.avatars.view({ id: userId, organizationId });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      phone: user.phone,
      avatarUrl: avatar.url,
      locale: user.locale,
      timezone: user.timezone,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      mfaEnabled: user.mfaFactors.length > 0,
      /**
       * A senha atual é provisória?
       *
       * Publicado porque é o **cliente** que precisa agir: web e mobile levam
       * quem entra com senha temporária direto para a troca, antes de qualquer
       * outra tela. Sem este campo o guard do frontend já existia e nunca
       * disparava — lia `mustChangePassword` de um perfil que não o continha.
       */
      mustChangePassword: user.credential?.mustChangePassword ?? false,
      welcomeDismissedAt: user.welcomeDismissedAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * O usuário, ou a recusa.
   *
   * Separado de [get] porque quase ninguém que precisa confirmar a existência
   * precisa da foto — e [get] assina uma URL de storage. Chamá-lo só para
   * validar acoplaria a troca de nome e o cadastro de MFA ao provedor de
   * arquivos: uma indisponibilidade lá derrubaria os dois sem motivo.
   */
  private async requireUser(userId: string) {
    const user = await this.repository.findById(userId);
    if (!user || user.deletedAt) throw new EntityNotFoundException('User');
    return user;
  }

  /** O e-mail de quem está se cadastrando no MFA. Não toca no storage. */
  async email(userId: string): Promise<string> {
    return (await this.requireUser(userId)).email;
  }

  async update(userId: string, input: UpdateProfileDto) {
    const user = await this.requireUser(userId);
    const { dismissWelcome, ...data } = input;
    return this.repository.updateProfile(userId, {
      ...data,
      ...(dismissWelcome
        ? { welcomeDismissedAt: user.welcomeDismissedAt ?? new Date() }
        : {}),
    });
  }

  /**
   * Troca a própria senha.
   *
   * Exige a senha atual — sem isso, uma sessão sequestrada trocaria a senha e
   * expulsaria o dono da conta. É a diferença entre este fluxo e o de
   * recuperação por e-mail, que existe justamente para quem **não** tem a
   * senha atual e prova identidade por outro canal.
   *
   * A verificação é `verify` do provedor de hash; nenhuma comparação de texto
   * acontece aqui.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    keepSessionId?: string,
  ): Promise<void> {
    const credential = await this.repository.findCredential(userId);
    if (!credential) throw new EntityNotFoundException('Credential');

    const matches = await this.hashes.verify(
      credential.passwordHash,
      input.currentPassword,
    );
    if (!matches) {
      throw new ValidationException('Current password does not match');
    }

    if (input.currentPassword === input.newPassword) {
      throw new ValidationException(
        'The new password must be different from the current one',
      );
    }

    await this.repository.changePassword(
      userId,
      await this.hashes.hash(input.newPassword),
      keepSessionId,
    );
  }
}
