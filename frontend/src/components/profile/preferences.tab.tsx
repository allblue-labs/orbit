"use client";

/**
 * Preferências pessoais.
 *
 * ## Idioma e fuso são do contrato
 *
 * `PATCH /identity/me` aceita `locale` e `timezone`, e são eles que o backend
 * usa — o fuso decide como as datas de agenda são interpretadas do lado do
 * servidor, não só como aparecem.
 *
 * ## Tema não existe, e não é criado aqui
 *
 * `PATCH /identity/me` recusa `theme` (verificado), e a aplicação não tem
 * alternância de tema implementada. Guardar a escolha no navegador seria a
 * **configuração paralela** que o enunciado proíbe: um valor que o backend não
 * conhece, que não acompanha a pessoa entre dispositivos, e que teria de ser
 * migrado quando o contrato existir.
 *
 * A ausência é declarada.
 */
import { useState } from "react";
import { Globe, Palette } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanelError, PanelLoading } from "@/components/panels";
import { useProfile, useUpdateProfile } from "@/hooks/profile/use-profile";
import type { UserProfile } from "@/types/settings";

/**
 * Idiomas oferecidos.
 *
 * `locale` é `VarChar(16)` livre no contrato — não há catálogo. A lista cobre
 * o que a interface de fato traduz hoje; um valor fora dela continua sendo
 * aceito pelo servidor.
 */
const LOCALES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (United States)" },
  { value: "es-ES", label: "Español" },
];

/**
 * Fusos oferecidos.
 *
 * Os do Brasil, que é onde a operação acontece. Como `timezone` é texto livre,
 * o valor que já estiver salvo aparece mesmo se não estiver nesta lista — um
 * fuso configurado por outra via não deve sumir da tela.
 */
const TIMEZONES = [
  "America/Recife",
  "America/Sao_Paulo",
  "America/Fortaleza",
  "America/Bahia",
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Rio_Branco",
  "America/Noronha",
];

export function PreferencesTab() {
  const query = useProfile();

  if (query.isPending) return <PanelLoading rows={4} />;
  if (query.error || !query.data) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return <Form key={query.data.updatedAt} profile={query.data} />;
}

function Form({ profile }: { profile: UserProfile }) {
  const update = useUpdateProfile();

  const [locale, setLocale] = useState(profile.locale ?? "pt-BR");
  const [timezone, setTimezone] = useState(
    profile.timezone ?? "America/Recife",
  );

  /** Um fuso salvo fora da lista não deve desaparecer do seletor. */
  const zones = TIMEZONES.includes(timezone)
    ? TIMEZONES
    : [timezone, ...TIMEZONES];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ locale, timezone });
      }}
      className="max-w-2xl space-y-6"
    >
      <section className="glass-panel space-y-4 rounded-xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          Idioma e fuso horário
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="preferences-locale">Idioma</Label>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger id="preferences-locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferences-timezone">Fuso horário</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="preferences-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O fuso não é só apresentação: ele define como janelas de agenda e escalas são interpretadas.
            </p>
          </div>
        </div>

        <MutationError error={update.error} />

        <div className="flex items-center justify-end gap-3">
          {update.isSuccess ? (
            <span className="text-xs text-muted-foreground">Salvo.</span>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-dashed border-border p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Palette className="size-4 text-muted-foreground" aria-hidden />
          Tema
        </h2>
        <p className="text-sm text-muted-foreground">
          O contrato de perfil não tem preferência de tema, e a aplicação ainda
          não oferece alternância — a interface é escura.
        </p>
        <p className="text-xs text-muted-foreground">
          Guardar a escolha só neste navegador seria uma configuração paralela:
          um valor que fica só neste navegador, que não acompanha você em outro
          dispositivo e que teria de ser migrado quando o contrato existir.
        </p>
      </section>
    </form>
  );
}
