"use client";

/**
 * O contrato do PMOC, para o contratante ler e assinar.
 *
 * ## Quem usa esta tela
 *
 * Alguém sem conta no Orbit, provavelmente no telefone, que recebeu um link por
 * WhatsApp. Isso dita tudo: nenhum jargão do sistema, nenhum id, nenhuma navegação —
 * e a leitura antes da assinatura, porque assinar é o ato, não o objetivo.
 *
 * ## Três telas, não uma com condicionais soltas
 *
 * `etapaDoContrato` decide qual, e a decisão está testada. O caso que justifica o
 * módulo separado é `JA_ASSINADO`: é desfecho feliz, e tratá-lo como erro mandaria
 * quem teve sucesso pedir outro link.
 *
 * ## O resumo continua visível depois de assinar
 *
 * Quem assinou acabou de assumir um compromisso e é a última chance de vê-lo sem
 * pedir nada a ninguém. Trocar tudo por "obrigado" apagaria da tela o que foi aceito.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  Loader2,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/signature/signature-pad";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { pmocContractService } from "@/services/pmoc-contract.service";
import type { PmocPublicContract } from "@/types/pmoc";
import {
  assinaturaFoiRegistrada,
  etapaDoContrato,
  podeAssinar,
} from "./contract-signing.model";

export function PmocContractSigning({ token }: { token: string }) {
  /**
   * `retry: false` e sem refetch no foco.
   *
   * As falhas desta rota não são transitórias — token inexistente é 404, e repetir
   * não o cria. E voltar à aba não deve recarregar um contrato que a pessoa está
   * lendo, muito menos enquanto ela já desenhou a assinatura e não enviou.
   */
  const contrato = useQuery({
    queryKey: ["pmoc-public-contract", token],
    queryFn: () => pmocContractService.read(token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (contrato.isLoading) {
    return (
      <Moldura>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando o contrato…
        </div>
      </Moldura>
    );
  }

  if (contrato.error || !contrato.data) {
    return (
      <Moldura>
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Não encontramos este contrato</AlertTitle>
          <AlertDescription>
            O link pode ter sido digitado incompleto. Confira o endereço que você
            recebeu ou peça um novo a quem enviou.
          </AlertDescription>
        </Alert>
      </Moldura>
    );
  }

  return <Conteudo token={token} contrato={contrato.data} />;
}

function Conteudo({
  token,
  contrato,
}: {
  token: string;
  contrato: PmocPublicContract;
}) {
  /**
   * O estado depois de assinar sobrepõe o que veio na carga.
   *
   * Sem isto a tela continuaria mostrando o formulário depois de o envio dar certo,
   * porque `contrato.state` é o valor de quando a página abriu.
   */
  const [assinado, setAssinado] = useState(false);
  const etapa = assinado ? "CONCLUIDO" : etapaDoContrato(contrato.state);

  return (
    <Moldura emitente={contrato.emitter.name}>
      <div className="space-y-6">
        <ResumoDoContrato contrato={contrato} />

        {etapa === "ASSINAR" ? (
          <FormularioDeAssinatura
            token={token}
            expiresAt={contrato.expiresAt}
            onAssinado={() => setAssinado(true)}
          />
        ) : null}

        {etapa === "CONCLUIDO" ? (
          <Alert>
            <BadgeCheck />
            <AlertTitle>Contrato assinado</AlertTitle>
            <AlertDescription>
              {contrato.signature
                ? `Assinado por ${contrato.signature.signerName ?? "contratante"} em ${formatDateTime(
                    contrato.signature.signedAt,
                  )}. Nada mais é necessário da sua parte.`
                : "Recebemos sua assinatura. Nada mais é necessário da sua parte."}
            </AlertDescription>
          </Alert>
        ) : null}

        {etapa === "RECUSADO" ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Este link não está mais válido</AlertTitle>
            {/* A frase vem do servidor: expirado e substituído têm instruções
                diferentes, e é ele que sabe qual dos dois aconteceu. */}
            <AlertDescription>
              {contrato.reason ??
                "Peça um novo link a quem enviou o contrato."}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Moldura>
  );
}

/**
 * O que está sendo contratado.
 *
 * Em linhas rotuladas, e não em prosa: a pessoa está conferindo dados — partes,
 * vigência, periodicidade, quantos equipamentos —, e conferir é uma leitura de
 * varredura, não de leitura corrida.
 */
function ResumoDoContrato({ contrato }: { contrato: PmocPublicContract }) {
  const { plan } = contrato;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Plano de manutenção {plan.code}
        </p>
        <h1 className="text-balance text-xl font-semibold">{plan.name}</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Contratante" valor={contrato.customer.name} />
        <Campo rotulo="Contratada" valor={contrato.emitter.name} />
      </div>

      <Separator />

      <dl className="grid gap-4 sm:grid-cols-2">
        <Linha
          icone={<CalendarDays className="size-4" aria-hidden />}
          rotulo="Vigência"
          valor={
            plan.endsOn
              ? `${formatDate(plan.startsOn)} a ${formatDate(plan.endsOn)}`
              : `A partir de ${formatDate(plan.startsOn)}, sem prazo final`
          }
        />
        <Linha
          icone={<Repeat className="size-4" aria-hidden />}
          rotulo="Periodicidade"
          valor={plan.frequency}
        />
        <Linha
          icone={<Wrench className="size-4" aria-hidden />}
          rotulo="Equipamentos cobertos"
          valor={
            plan.coveredEquipment === 1
              ? "1 equipamento"
              : `${plan.coveredEquipment} equipamentos`
          }
        />
        {/* O Responsável Técnico é exigência do PMOC, e é quem assina pela
            contratada — quem assina do outro lado tem o direito de saber o nome. */}
        {plan.technicalResponsible ? (
          <Linha
            icone={<ShieldCheck className="size-4" aria-hidden />}
            rotulo="Responsável Técnico"
            valor={plan.technicalResponsible}
          />
        ) : null}
      </dl>
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-medium">{valor}</p>
    </div>
  );
}

function Linha({
  icone,
  rotulo,
  valor,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground">{icone}</span>
      <div>
        <dt className="text-xs text-muted-foreground">{rotulo}</dt>
        <dd className="text-sm font-medium">{valor}</dd>
      </div>
    </div>
  );
}

/**
 * A coleta da assinatura.
 *
 * O nome é obrigatório e os outros dois não: CPF/CNPJ e e-mail reforçam a prova, mas
 * exigi-los faria o aceite falhar por um dado que o contratante talvez não queira
 * dar numa página aberta por link.
 */
function FormularioDeAssinatura({
  token,
  expiresAt,
  onAssinado,
}: {
  token: string;
  expiresAt: string;
  onAssinado: () => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [temTraco, setTemTraco] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerDocument, setSignerDocument] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  /** Recusa devolvida pelo servidor no envio — o link virou inválido no caminho. */
  const [recusa, setRecusa] = useState<string | null>(null);

  const assinatura = useMutation({
    mutationFn: async () => {
      const png = await padRef.current?.exportar();
      if (!png) throw new Error("Desenhe sua assinatura antes de confirmar.");
      return pmocContractService.sign(token, {
        signerName: signerName.trim(),
        signerDocument: signerDocument.trim() || undefined,
        signerEmail: signerEmail.trim() || undefined,
        signatureBase64: await blobParaBase64(png),
      });
    },
    onSuccess: (resultado) => {
      /**
       * O servidor pode recusar sem erro.
       *
       * Link expirado ou substituído entre a carga e o envio devolvem o estado, não
       * uma exceção — e a recusa precisa aparecer, ou o contratante fica olhando um
       * botão que "não fez nada".
       */
      if (assinaturaFoiRegistrada(resultado)) {
        onAssinado();
        return;
      }
      /* O `??` cobre um estado de recusa sem frase: calar aqui deixaria o botão
         parecendo que não fez nada. */
      setRecusa(
        resultado.reason ??
          "Não foi possível registrar a assinatura. Peça um novo link a quem enviou o contrato.",
      );
    },
  });

  const habilitado = podeAssinar({
    signerName,
    temTraco,
    enviando: assinatura.isPending,
  });

  if (recusa) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Não foi possível registrar a assinatura</AlertTitle>
        <AlertDescription>{recusa}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (habilitado) assinatura.mutate();
      }}
    >
      <Separator />

      <div>
        <h2 className="font-semibold">Assinatura do contratante</h2>
        <p className="text-sm text-muted-foreground">
          Ao assinar, você confirma o plano de manutenção descrito acima.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="signerName">Nome de quem assina</Label>
          <Input
            id="signerName"
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="Nome completo"
            autoComplete="name"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signerDocument">
            CPF ou CNPJ{" "}
            <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="signerDocument"
            value={signerDocument}
            onChange={(event) => setSignerDocument(event.target.value)}
            inputMode="numeric"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signerEmail">
            E-mail <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="signerEmail"
            type="email"
            value={signerEmail}
            onChange={(event) => setSignerEmail(event.target.value)}
            autoComplete="email"
          />
        </div>
      </div>

      <SignaturePad
        handleRef={padRef}
        onChange={setTemTraco}
        disabled={assinatura.isPending}
        label="Desenhe sua assinatura no quadro"
      />

      <MutationError error={assinatura.error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Este link vale até {formatDateTime(expiresAt)}.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              padRef.current?.limpar();
              setTemTraco(false);
            }}
            disabled={!temTraco || assinatura.isPending}
          >
            <RefreshCw className="size-4" />
            Refazer
          </Button>
          <Button type="submit" disabled={!habilitado}>
            {assinatura.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BadgeCheck className="size-4" />
            )}
            Assinar contrato
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * A moldura da página.
 *
 * Centrada e estreita de propósito: é um documento, e documento se lê numa coluna.
 * O rodapé nomeia quem emitiu — numa página sem menu nem cabeçalho de sistema, é o
 * que diz ao contratante de onde o link veio.
 */
function Moldura({
  children,
  emitente,
}: {
  children: React.ReactNode;
  emitente?: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <OrbitLogo className="h-7 w-auto self-start" />
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7">
        {children}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {emitente
          ? `Contrato enviado por ${emitente}.`
          : "Documento enviado pelo Orbit."}
      </p>
    </main>
  );
}

/**
 * O PNG como base64, que é o formato que a rota aceita.
 *
 * `readAsDataURL` produz `data:image/png;base64,…`, e o backend tolera o prefixo —
 * removê-lo aqui seria tirar a única pista do tipo que a string carrega.
 */
function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Leitura falhou"));
    reader.readAsDataURL(blob);
  });
}
