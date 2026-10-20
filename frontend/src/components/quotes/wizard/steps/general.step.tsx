"use client";

/**
 * Passo 2 — cliente, onde, em quê, e o que se vai propor.
 *
 * ## Endereço e equipamento dependem do cliente
 *
 * Os dois só existem depois da escolha, e por isso não são consultados antes —
 * um formulário com quatro seletores fechados não deve disparar quatro consultas
 * ao montar. Trocar o cliente **limpa** os dois: manter o endereço da empresa
 * anterior sairia impresso na proposta nova, e é o tipo de erro que ninguém
 * revisa porque o campo parecia preenchido.
 *
 * ## A abertura mostra o padrão sem copiá-lo
 *
 * O texto padrão é do compositor do documento, que é quem o imprime. O campo o
 * exibe como sugestão e envia **vazio** quando ninguém escreveu — assim a
 * proposta não carrega uma cópia congelada de uma frase que a empresa pode
 * querer mudar depois.
 *
 * Preenchê-lo de verdade copiaria a constante para cá, e duas cópias de uma
 * frase divergem: a tela mostraria uma coisa e o PDF imprimiria outra.
 */
import { useEffect, useMemo } from "react";
import { MapPin, Package } from "lucide-react";

import { CustomerPicker } from "@/components/customers/customer-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAssetsList } from "@/hooks/assets/use-assets";
import { useCustomerAddresses } from "@/hooks/customers/use-customers";
import type { QuoteDraft } from "../quote-wizard.model";

/** Quantos equipamentos do cliente oferecer sem paginar. */
const ASSET_LIMIT = 50;

/** O `Select` precisa de um valor real para "nenhum". */
const NO_ADDRESS = "__none__";

export function GeneralStep({
  draft,
  onChange,
}: {
  draft: QuoteDraft;
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  const addresses = useCustomerAddresses(draft.customerId, true);
  const assets = useAssetsList(
    { customerId: draft.customerId ?? undefined, page: 1, limit: ASSET_LIMIT },
    { enabled: Boolean(draft.customerId) },
  );

  /*
   * O endereço principal entra sozinho, quando há um só.
   *
   * Com uma opção, pedir escolha é pedir um clique cuja resposta já se conhece —
   * e sem escolha o documento cai no endereço principal de qualquer forma. Com
   * duas ou mais, a escolha é real e fica com a pessoa.
   */
  /* `useMemo` porque o efeito depende disto: `addresses.data ?? []` cria um array
     novo em cada render, e o efeito rodaria a cada um. */
  const lista = useMemo(() => addresses.data ?? [], [addresses.data]);
  useEffect(() => {
    if (draft.serviceAddressId || lista.length !== 1) return;
    onChange({ serviceAddressId: lista[0]!.id });
  }, [draft.serviceAddressId, lista, onChange]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="wizard-customer">Cliente</Label>
        <CustomerPicker
          id="wizard-customer"
          value={draft.customerId ?? undefined}
          selectedLabel={draft.customerLabel ?? undefined}
          placeholder="Escolher cliente"
          onChange={(customer) =>
            /* Trocar o cliente descarta endereço e equipamentos: eram de outra
               empresa, e sairiam impressos na proposta nova. */
            onChange({
              customerId: customer?.id ?? null,
              customerLabel: customer
                ? (customer.tradeName ?? customer.legalName)
                : null,
              serviceAddressId: null,
              assetIds: [],
            })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="wizard-address" className="flex items-center gap-2">
          <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
          Endereço de execução
        </Label>
        {!draft.customerId ? (
          <p className="text-xs text-muted-foreground">
            Escolha o cliente para ver os endereços cadastrados.
          </p>
        ) : addresses.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : lista.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Este cliente não tem endereço cadastrado. A proposta sai sem
            endereço; dá para cadastrar um na ficha do cliente.
          </p>
        ) : (
          <Select
            value={draft.serviceAddressId ?? NO_ADDRESS}
            onValueChange={(value) =>
              onChange({
                serviceAddressId: value === NO_ADDRESS ? null : value,
              })
            }
          >
            <SelectTrigger id="wizard-address">
              <SelectValue placeholder="Escolher endereço" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ADDRESS}>Sem endereço definido</SelectItem>
              {lista.map((address) => (
                <SelectItem key={address.id} value={address.id}>
                  {address.label} — {address.street}
                  {address.number ? `, ${address.number}` : ""} · {address.city}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Package className="size-3.5 text-muted-foreground" aria-hidden />
          Equipamentos
        </Label>
        {!draft.customerId ? (
          <p className="text-xs text-muted-foreground">
            Escolha o cliente para ver os equipamentos dele.
          </p>
        ) : assets.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (assets.data?.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum equipamento cadastrado para este cliente. A proposta pode
            seguir sem — a seção de equipamentos simplesmente não é impressa.
          </p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {(assets.data?.data ?? []).map((asset) => {
              const checked = draft.assetIds.includes(asset.id);
              return (
                <label
                  key={asset.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() =>
                      onChange({
                        assetIds: checked
                          ? draft.assetIds.filter((id) => id !== asset.id)
                          : [...draft.assetIds, asset.id],
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                  {asset.identifier ? (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {asset.identifier}
                    </span>
                  ) : null}
                  {asset.location ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {asset.location}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="wizard-title">Título</Label>
          <Input
            id="wizard-title"
            value={draft.title}
            maxLength={220}
            placeholder="Ex.: Manutenção preventiva do parque de climatização"
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-valid">Válido até</Label>
          <Input
            id="wizard-valid"
            type="date"
            value={draft.validUntil}
            onChange={(event) => onChange({ validUntil: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            A data de emissão é a de hoje e o documento a imprime — o que se
            escolhe aqui é até quando a proposta vale.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wizard-intro">Texto de abertura</Label>
        <Textarea
          id="wizard-intro"
          value={draft.introText}
          rows={2}
          maxLength={2000}
          placeholder="Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado."
          onChange={(event) => onChange({ introText: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          É a primeira frase da proposta. <strong>Em branco</strong>, sai
          exatamente o texto acima.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wizard-notes">Objeto da proposta</Label>
        <Textarea
          id="wizard-notes"
          value={draft.notes}
          rows={4}
          maxLength={4000}
          placeholder="O que será feito, o que está incluído e o que não está."
          onChange={(event) => onChange({ notes: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Sai no documento como o escopo. É onde o cliente confere o que está
          contratando.
        </p>
      </div>
    </div>
  );
}
