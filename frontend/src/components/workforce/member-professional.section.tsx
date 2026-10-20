"use client";

/**
 * O perfil profissional de um membro.
 *
 * ## Duas leituras que a tela mantém separadas
 *
 * Logo abaixo, "Papel e permissões efetivas" mostra o **acesso**: o papel RBAC
 * e o que ele libera no sistema. Esta seção mostra o **ofício**: o que a
 * pessoa faz em campo, com que registro profissional, e se tem assinatura
 * cadastrada.
 *
 * São coisas diferentes e independentes. Um gestor com acesso total pode não
 * ter papel profissional nenhum; um Responsável Técnico pode ter acesso
 * mínimo ao sistema. Juntá-las num crachá só de "Técnico" é o erro que este
 * domínio existe para evitar.
 *
 * ## Credencial não concede papel
 *
 * Possuir CREA não faz de ninguém Responsável Técnico. O papel é o que o
 * backend publica em `professionalRoles`; a credencial aparece ao lado como
 * informação administrativa, e a tela nunca deduz um a partir do outro.
 *
 * ## Os papéis passaram a ser editáveis
 *
 * Eram somente leitura, "enquanto não houver superfície Web" — e o endpoint
 * existia. A consequência não era estética: sem perfil de técnico de campo a
 * pessoa não pode ser atribuída a um atendimento, não aparece entre os técnicos e
 * não ganha comissão. Dava para cadastrar um membro com papel de acesso
 * "Técnico Operacional" e ele continuar invisível para a operação.
 *
 * Credencial e assinatura continuam em leitura: a credencial tem endpoint
 * próprio com validação de conselho, e a assinatura é pessoal — quem assina é
 * quem cadastra, no próprio perfil.
 */
import { PanelError } from "@/components/panels";
import {
  ProfessionalCredentialSummary,
  ProfessionalRoles,
  ProfessionalSignatureStatus,
  ProfessionalStatus,
} from "@/components/professional/professional-presentation";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfessionalProfile } from "@/hooks/workforce/use-workforce";
import { ProfessionalRolesEditor } from "./professional-roles.editor";

export function MemberProfessionalSection({
  userId,
  canManage = false,
}: {
  userId: string;
  canManage?: boolean;
}) {
  const profile = useProfessionalProfile(userId);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Perfil profissional</h3>

      <div className="space-y-3 rounded-xl border border-border p-4">
        {profile.isPending ? (
          <>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </>
        ) : profile.error ? (
          /**
           * Ausência não é erro.
           *
           * Um membro sem perfil profissional é o caso comum — quem trabalha
           * no escritório não tem. O backend responde 404, e a tela diz isso
           * em vez de mostrar uma falha.
           */
          profile.error.isNotFound ? (
            <>
              <p className="text-sm text-muted-foreground">
                Este membro não possui perfil profissional. Papéis de campo são
                cadastrados separadamente do acesso ao sistema — e sem o de
                técnico de campo a pessoa não pode ser atribuída a um
                atendimento.
              </p>
              {/* O primeiro salvamento cria o perfil. */}
              <ProfessionalRolesEditor
                userId={userId}
                profile={null}
                canManage={canManage}
              />
            </>
          ) : (
            <PanelError
              error={profile.error}
              onRetry={() => void profile.refetch()}
            />
          )
        ) : profile.data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProfessionalRoles roles={profile.data.professionalRoles} />
              <ProfessionalStatus active={profile.data.active} />
            </div>

            <ProfessionalSignatureStatus
              available={profile.data.signatureAvailable}
            />

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Registros profissionais
              </p>
              {profile.data.professionalCredentials.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum registro cadastrado.
                </p>
              ) : (
                <ul className="space-y-1">
                  {profile.data.professionalCredentials.map((credential) => (
                    <li key={credential.id}>
                      <ProfessionalCredentialSummary credential={credential} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ProfessionalRolesEditor
              userId={userId}
              profile={profile.data}
              canManage={canManage}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
