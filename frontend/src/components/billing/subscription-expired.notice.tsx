"use client";

/**
 * O aviso de assinatura vencida.
 *
 * ## Uma vez, e sai do caminho
 *
 * A avaliação acaba e a pessoa continua tendo trabalho a fazer — consultar um
 * atendimento antigo, baixar o PMOC que o cliente está cobrando. Um modal que
 * volta a cada navegação transformaria isso numa parede, e a reação a uma
 * parede é fechar a aba, não assinar.
 *
 * Aparece uma vez por sessão do navegador, fecha no Esc e no clique fora, e
 * deixa no lugar dele o selo discreto da topbar — que continua ali enquanto a
 * assinatura estiver vencida, sem interromper nada.
 *
 * ## Uma vez, e sai do caminho de verdade
 *
 * Dispensado, não volta — nem ao navegar, nem ao recarregar dentro de doze
 * horas. Quem lembra é `SubscriptionNoticeProvider`, no layout raiz: este
 * componente vive dentro do `AppShell`, que remonta a cada navegação, e
 * guardar a decisão aqui a perdia no primeiro clique do menu.
 *
 * Doze horas porque isto é "já li hoje", não uma preferência. Guardar para
 * sempre faria com que quem dispensou o aviso em setembro não fosse mais
 * lembrado em outubro.
 *
 * Depois disso, quem conta a história é o selo da topbar — presente em toda
 * tela, sem interromper nenhuma, e clicável para a aba onde se contrata.
 */
import Link from "next/link";
import { CalendarX2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/providers/session-provider";
import { ROUTE_ASSINATURA, dataDeVencimento } from "./subscription-access";
import { useAvisoDeAssinatura } from "./subscription-notice-provider";

export function SubscriptionExpiredNotice() {
  const session = useSession();
  const { dispensado, dispensar } = useAvisoDeAssinatura();
  const vencida = session.isAuthenticated && !session.subscriptionActive;

  if (!vencida) return null;

  const venceuEm = dataDeVencimento(session.subscriptionEndsAt);

  return (
    <Dialog
      open={!dispensado}
      onOpenChange={(estado) => !estado && dispensar()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-warning/12 text-warning">
            <CalendarX2 className="size-5" aria-hidden />
          </div>
          <DialogTitle>Sua avaliação gratuita terminou</DialogTitle>
          <DialogDescription>
            {venceuEm
              ? `O período de acesso foi até ${venceuEm}. Escolha um plano para voltar a registrar atendimentos.`
              : "Escolha um plano para voltar a registrar atendimentos."}
          </DialogDescription>
        </DialogHeader>

        {/*
          O que continua funcionando fica dito, e não subentendido.

          Sem isto a pessoa conclui que perdeu o acesso aos próprios dados e o
          primeiro impulso é ligar para o suporte perguntando por eles.
        */}
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Enquanto isso, você continua podendo:</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>· consultar clientes, atendimentos e o histórico;</li>
            <li>· baixar os documentos e relatórios já emitidos.</li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            O que fica pausado é criar e alterar registros.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={dispensar}>
            Agora não
          </Button>
          <Button asChild onClick={dispensar}>
            <Link href={ROUTE_ASSINATURA}>Ver planos</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
