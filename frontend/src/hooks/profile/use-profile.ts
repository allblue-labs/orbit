"use client";

/**
 * Query Layer de Perfil e preferências.
 *
 * ## Cadência
 *
 * Perfil muda por ato deliberado da própria pessoa — `CACHE.stable`, sem
 * revalidação automática. Sessões mudam quando alguém entra ou sai de um
 * dispositivo, o que acontece fora desta aba: `CACHE.fresh`, revalidando ao
 * voltar o foco.
 *
 * ## A sessão da aplicação é outra coisa
 *
 * `useSession()` (o provider) carrega o **contexto autenticado** — permissões,
 * capabilities, organização. `profileService.get()` carrega o **cadastro** da
 * pessoa. São dois contratos diferentes, com donos diferentes, e por isso duas
 * consultas: editar o telefone não deve invalidar as permissões.
 *
 * Editar o perfil **invalida a sessão da aplicação** mesmo assim, porque
 * `displayName` aparece no topo — e o topo lê da sessão.
 */
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { notificationsService } from "@/services/notifications.service";
import { profileService } from "@/services/profile.service";
import type {
  ChangePasswordInput,
  EnableMfaInput,
  UpdateNotificationPreferenceInput,
  UpdateProfileInput,
} from "@/types/settings";

export const PROFILE_REFRESH = {
  profile: CACHE.stable,
  sessions: CACHE.fresh,
  preferences: CACHE.stable,
} as const;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

export function useProfile() {
  return useApiQuery(
    profileService.keys.profile(),
    ({ signal }) => profileService.get({ signal }),
    PROFILE_REFRESH.profile,
  );
}

export function useDeviceSessions() {
  return useApiQuery(
    profileService.keys.sessions(),
    ({ signal }) => profileService.sessions({ signal }),
    PROFILE_REFRESH.sessions,
  );
}

export function useNotificationPreferences() {
  return useApiQuery(
    notificationsService.keys.preferences(),
    ({ signal }) => notificationsService.preferences({ signal }),
    PROFILE_REFRESH.preferences,
  );
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useApiMutation(
    (input: UpdateProfileInput) => profileService.update(input),
    {
      onSuccess: async (profile) => {
        /** Estado confirmado pelo servidor — não antecipação. */
        queryClient.setQueryData(profileService.keys.profile(), profile);
        /**
         * `displayName` aparece no topo, que lê da sessão da aplicação.
         * Sem isto, o nome antigo ficaria lá até a próxima navegação.
         */
        await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
      },
    },
  );
}

/**
 * Troca de senha.
 *
 * O servidor revoga as demais sessões — por isso a lista de dispositivos é
 * invalidada junto. A sessão atual sobrevive, então nada de logout aqui.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();

  return useApiMutation(
    (input: ChangePasswordInput) => profileService.changePassword(input),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: profileService.keys.sessions(),
        });
      },
    },
  );
}

function useSessionsInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: profileService.keys.sessions(),
    });
  };
}

export function useRevokeSession() {
  const invalidate = useSessionsInvalidation();
  return useApiMutation((id: string) => profileService.revokeSession(id), {
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------------ */
/* MFA                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cadastro de MFA.
 *
 * O `POST /mfa/enrollment` **gera um fator novo a cada chamada** — por isso é
 * mutação, não consulta: repetir não é idempotente, e um `useQuery` o
 * dispararia sozinho ao montar.
 */
export function useBeginMfaEnrollment() {
  return useApiMutation(() => profileService.beginMfaEnrollment());
}

function useProfileInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: profileService.keys.profile(),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.session() }),
    ]);
  };
}

/** Dismissing the guide does not overwrite cached photo or MFA state with a PATCH projection. */
export function useDismissWelcome() {
  const invalidate = useProfileInvalidation();
  return useApiMutation(() => profileService.update({ dismissWelcome: true }), {
    onSuccess: invalidate,
  });
}

export function useEnableMfa() {
  const invalidate = useProfileInvalidation();
  return useApiMutation(
    (input: EnableMfaInput) => profileService.enableMfa(input),
    { onSuccess: invalidate },
  );
}

export function useDisableMfa() {
  const invalidate = useProfileInvalidation();
  return useApiMutation(() => profileService.disableMfa(), {
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------------ */
/* Preferências de notificação                                          */
/* ------------------------------------------------------------------ */

/**
 * `PATCH /notifications/preferences` faz **upsert de um tipo por vez**.
 *
 * Não substitui o conjunto: mandar um tipo não apaga os outros. É por isso que
 * a tela salva evento a evento, em vez de montar um payload com tudo.
 */
export function useSetNotificationPreference() {
  const queryClient = useQueryClient();

  return useApiMutation(
    (input: UpdateNotificationPreferenceInput) =>
      notificationsService.setPreference(input),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: notificationsService.keys.preferences(),
        });
      },
      /** Serializa: dois toggles seguidos no mesmo tipo não se cruzam. */
      scope: { id: "notification-preferences" },
    },
  );
}
