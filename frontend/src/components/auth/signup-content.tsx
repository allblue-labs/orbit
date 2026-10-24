"use client";

import Link from "next/link";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PostalCodeField } from "@/components/address/postal-code-field";
import { LegalDocumentsPanel } from "@/components/legal/legal-documents-panel";
import { LEGAL_DOCUMENT_VERSION } from "@/types/contracts/modules/legal/legal.read-models";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRegister } from "@/hooks/api";
import {
  formatCentavos,
  formatLimite,
  rotuloDoRecurso,
} from "@/components/billing/billing-format";
import {
  TRIAL_DAYS,
  ofereceAvaliacao,
  ordenarPlanos,
} from "@/components/pricing/pricing-catalog";
import {
  BILLING_INTERVALS,
  BILLING_INTERVAL_LABELS,
  type BillingIntervalCode,
  type PlanCatalog,
  type PlanCatalogEntry,
} from "@/types/billing";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  detectBrazilianDocumentType,
  formatBrazilianDocument,
  isValidBrazilianDocument,
  normalizeBrazilianDocument,
} from "@/lib/brazilian-document";
import type { PostalAddress } from "@/lib/postal-code";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-error";
import { errorCopy } from "@/lib/error-copy";

const schema = z
  .object({
    firstName: z.string().min(2, "Informe seu nome"),
    lastName: z.string().min(2, "Informe seu sobrenome"),
    email: z.string().email("Informe um e-mail válido"),
    password: z.string().min(12, "Use pelo menos 12 caracteres"),
    confirmPassword: z.string(),
    organizationName: z.string().min(2, "Informe o nome da organização"),
    legalName: z.string().min(2, "Informe a razão social"),
    documentNumber: z
      .string()
      .refine(isValidBrazilianDocument, "Informe um CPF ou CNPJ válido"),
    primarySegment: z.string().min(2, "Informe o segmento"),
    city: z.string().min(2, "Informe a cidade"),
    street: z.string().min(2, "Informe o endereço"),
    stateCode: z.string().length(2, "Use a sigla do estado"),
    planKey: z.string().min(1, "Escolha um plano para continuar"),
    billingInterval: z.enum(BILLING_INTERVALS),
    terms: z.boolean().refine(Boolean, "Aceite os termos para continuar"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem",
  });

type FormValues = z.infer<typeof schema>;
const registrationConflicts: Readonly<
  Record<string, { field: keyof FormValues; step: number }>
> = {
  REGISTRATION_DOCUMENT_ALREADY_EXISTS: { field: "documentNumber", step: 2 },
  REGISTRATION_EMAIL_ALREADY_EXISTS: { field: "email", step: 1 },
  REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE: {
    field: "organizationName",
    step: 2,
  },
};

const steps = [
  {
    title: "Escolha do plano",
    description: "Defina o plano da assinatura",
    icon: Sparkles,
  },
  { title: "Sua conta", description: "Você será o owner", icon: UserRound },
  {
    title: "Organização",
    description: "Identidade do workspace",
    icon: Building2,
  },
  {
    title: "Organização principal",
    description: "Base da operação",
    icon: MapPin,
  },
];

const LAST_STEP = steps.length - 1;

const fieldsByStep: (keyof FormValues)[][] = [
  ["planKey", "billingInterval"],
  ["firstName", "lastName", "email", "password", "confirmPassword"],
  ["organizationName", "legalName", "documentNumber", "primarySegment"],
  ["city", "street", "stateCode", "terms"],
];

/**
 * Os limites que ajudam a escolher, e só eles.
 *
 * O cartão trazia "N módulos habilitados" — contagem de uma lista interna de
 * capacidades, que não diz nada a quem está decidindo. O que separa os planos
 * na prática é quanta operação cabe: unidades, pessoas, clientes.
 */
const LIMITES_EM_DESTAQUE = [
  "BUSINESS_UNITS",
  "PLATFORM_USERS",
  "FIELD_TECHNICIANS",
  "ACTIVE_CUSTOMERS",
] as const;

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/**
 * Escolha do plano — primeira etapa do onboarding público.
 *
 * ## De onde vêm os planos
 *
 * Do catálogo comercial (`GET /plans/catalog`), lido no servidor e entregue
 * pronto. Antes vinham de `GET /plans`, que é a tabela: as suítes de direitos
 * criam planos ali ("Sem financeiro", "Catálogo sem estoque") e os internos
 * moram no mesmo lugar, então quem abria a conta escolhia entre dez cartões,
 * metade a R$ 0,00.
 *
 * ## "Gratuito" era a palavra errada
 *
 * O `STARTER` custa zero na tabela e o cartão dizia **Gratuito/mês** — que lê
 * como um plano permanentemente grátis. Não é: o que existe é a avaliação de
 * 30 dias do Essencial. O preço mostrado agora é sempre o preço real do plano,
 * e a avaliação aparece como o que é — um período, anunciado à parte.
 */
function PlanStep({
  catalog,
  selected,
  onSelect,
  billingInterval,
  onIntervalChange,
  error,
}: {
  catalog: PlanCatalog;
  selected: string;
  onSelect: (planKey: string) => void;
  billingInterval: BillingIntervalCode;
  onIntervalChange: (interval: BillingIntervalCode) => void;
  error?: string;
}) {
  const planos = ordenarPlanos(catalog.plans);

  if (planos.length === 0) {
    return (
      <Alert>
        <AlertTitle>Não foi possível carregar os planos</AlertTitle>
        <AlertDescription>
          Nenhum plano está disponível no momento. Tente novamente em instantes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={billingInterval}
        onValueChange={(value) =>
          onIntervalChange(value as BillingIntervalCode)
        }
      >
        <TabsList aria-label="Periodicidade da cobrança">
          {BILLING_INTERVALS.map((interval) => (
            <TabsTrigger key={interval} value={interval}>
              {BILLING_INTERVAL_LABELS[interval]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-4 sm:grid-cols-2">
        {planos.map((plano) => (
          <PlanCard
            key={plano.code}
            plano={plano}
            billingInterval={billingInterval}
            ativo={plano.code === selected}
            onSelect={() => onSelect(plano.code)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        O Essencial oferece avaliação para empresas elegíveis. Os demais planos
        exigem pagamento para liberar o acesso. Você pode trocar de plano pela
        área de assinatura.
      </p>
      <FieldError message={error} />
    </div>
  );
}

function PlanCard({
  plano,
  billingInterval,
  ativo,
  onSelect,
}: {
  plano: PlanCatalogEntry;
  billingInterval: BillingIntervalCode;
  ativo: boolean;
  onSelect: () => void;
}) {
  const preco = plano.prices[billingInterval];
  const comAvaliacao = ofereceAvaliacao(plano);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={ativo}
      className={cn(
        "rounded-xl border border-border p-5 text-left transition-colors",
        ativo
          ? "border-primary bg-secondary"
          : "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold">{plano.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {plano.description}
          </p>
        </div>
        {ativo ? <Check className="size-4 shrink-0 text-primary" /> : null}
      </div>

      <p className="mt-4 font-display text-2xl font-bold">
        {preco ? formatCentavos(preco.amountMinor) : "Sob consulta"}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {billingInterval === "MONTHLY"
            ? "/mês"
            : billingInterval === "SEMIANNUAL"
              ? "/semestre"
              : "/ano"}
        </span>
      </p>

      {/*
        A avaliação é um período, não um preço.

        Dizer "Gratuito" no lugar do valor fazia o plano parecer sempre grátis.
        O valor fica onde sempre esteve, e a avaliação vira o que é: trinta
        dias antes da primeira cobrança.
      */}
      {comAvaliacao ? (
        <p className="mt-2 inline-flex rounded-md bg-success/12 px-2 py-1 text-[11px] font-medium text-success">
          {TRIAL_DAYS} dias grátis antes da primeira cobrança
        </p>
      ) : null}

      <dl className="mt-4 space-y-1 border-t border-border/70 pt-3">
        {LIMITES_EM_DESTAQUE.map((recurso) => {
          const limite = plano.allocation[recurso];
          if (!limite) return null;
          return (
            <div key={recurso} className="flex justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">
                {rotuloDoRecurso(recurso)}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatLimite(limite)}
              </dd>
            </div>
          );
        })}
      </dl>
    </button>
  );
}

export function SignupContent({
  catalog,
  initialSelection = { planKey: "", billingInterval: "MONTHLY" },
}: {
  catalog: PlanCatalog;
  initialSelection?: { planKey: string; billingInterval: BillingIntervalCode };
}) {
  const createAccount = useRegister();
  const [registrationError, setRegistrationError] = useState<{
    message: string;
    canSignIn: boolean;
  } | null>(null);
  const [step, setStep] = useState(initialSelection.planKey ? 1 : 0);
  /** O CEP não faz parte do cadastro; só preenche o endereço da matriz. */
  const [cep, setCep] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      primarySegment: "Serviços",
      stateCode: "",
      planKey: initialSelection.planKey,
      billingInterval: initialSelection.billingInterval,
      terms: false,
    },
  });
  const selectedPlan = useWatch({ control, name: "planKey" });
  const billingInterval = useWatch({ control, name: "billingInterval" });
  const plan = catalog.plans.find((entry) => entry.code === selectedPlan);
  const documentNumber = useWatch({ control, name: "documentNumber" });
  const termsAccepted = useWatch({ control, name: "terms" });

  async function next() {
    // O retorno do servidor pertence à tentativa anterior. Revalide os campos
    // editados antes de avançar, sem prender o wizard a um erro antigo.
    for (const field of fieldsByStep[step]) {
      if (errors[field]?.type === "server") clearErrors(field);
    }
    if (await trigger(fieldsByStep[step])) {
      setRegistrationError(null);
      setStep((current) =>
        current === step ? Math.min(current + 1, LAST_STEP) : current,
      );
    }
  }

  async function submit(values: FormValues) {
    setRegistrationError(null);
    const { confirmPassword: _, terms: __, ...payload } = values;
    try {
      await createAccount.mutateAsync({
        ...payload,
        acceptTerms: values.terms,
        termsVersion: LEGAL_DOCUMENT_VERSION,
        privacyVersion: LEGAL_DOCUMENT_VERSION,
        stateCode: payload.stateCode.toUpperCase(),
        documentNumber: normalizeBrazilianDocument(payload.documentNumber),
        documentType: detectBrazilianDocumentType(payload.documentNumber)!,
        client: "WEB",
        businessUnitType: "HEADQUARTERS",
      });
      toast.success("Cadastro concluído");
    } catch (error) {
      const message = errorCopy(error);
      const code = error instanceof ApiError ? error.code : "";
      setRegistrationError({
        message,
        canSignIn: [
          "REGISTRATION_DOCUMENT_ALREADY_EXISTS",
          "REGISTRATION_EMAIL_ALREADY_EXISTS",
          "REGISTRATION_USE_EXISTING_ACCOUNT",
        ].includes(code),
      });
      const conflict = registrationConflicts[code];
      if (conflict) {
        setError(conflict.field, { type: "server", message });
        setStep(conflict.step);
      }
    }
  }

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[22rem_1fr]">
      <aside className="bg-gradient-orbit relative hidden overflow-hidden p-8 text-primary-foreground lg:flex lg:flex-col">
        <div className="absolute -top-20 -left-20 size-64 rounded-full border border-primary-foreground/20" />
        {/*
          A marca leva para casa.

          Não havia nenhuma saída desta tela: quem entrava para olhar os planos
          e desistia só tinha o botão de voltar do navegador. A marca clicável
          é a convenção — e o link explícito abaixo, no cabeçalho, atende quem
          não a experimenta.
        */}
        <Link
          href="/"
          aria-label="Orbit — voltar para a página inicial"
          className="relative rounded-lg focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:outline-none [&_span]:text-primary-foreground [&_svg]:text-primary-foreground"
        >
          <OrbitLogo />
        </Link>
        <div className="relative my-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-primary-foreground/70 uppercase">
            Novo workspace
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold leading-tight">
            Sua operação começa com uma base segura.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-primary-foreground/75">
            Configure a organização em poucos passos. Você entra como owner e
            pode convidar o time depois.
          </p>
          <ol className="mt-10 space-y-2">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = index === step;
              const complete = index < step;
              return (
                <li
                  key={item.title}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 transition-colors",
                    active && "bg-primary-foreground/12",
                  )}
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
                    {complete ? (
                      <Check className="size-4" />
                    ) : (
                      <Icon className="size-4" />
                    )}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block text-xs text-primary-foreground/65">
                      {item.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-primary-foreground/70">
          <ShieldCheck className="size-4" />
          Sessão segura e dados isolados por organização
        </div>
      </aside>

      <section className="flex min-w-0 flex-col px-5 py-6 sm:px-10 lg:px-16">
        <header className="flex flex-wrap items-center justify-between gap-y-2">
          <Link href="/" aria-label="Orbit — início" className="lg:hidden">
            <OrbitLogo />
          </Link>
          <span className="hidden text-sm text-muted-foreground lg:block">
            Etapa {step + 1} de {steps.length}
          </span>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft className="size-4" />
                Voltar ao site
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Já tenho uma conta</Link>
            </Button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-10">
          <form
            onSubmit={(event) => {
              if (step < LAST_STEP) {
                event.preventDefault();
                void next();
                return;
              }
              void handleSubmit(submit)(event);
            }}
            className="w-full"
          >
            {registrationError ? (
              <Alert variant="destructive" className="mb-6">
                <AlertTitle>Não foi possível concluir o cadastro</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{registrationError.message}</p>
                  {registrationError.canSignIn ? (
                    <Link
                      href="/login"
                      className="inline-block font-medium underline"
                    >
                      Entrar na minha conta
                    </Link>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="mb-8 flex gap-2 lg:hidden">
              {steps.map((item, index) => (
                <span
                  key={item.title}
                  className={cn(
                    "h-1 flex-1 rounded-full bg-muted",
                    index <= step && "bg-primary",
                  )}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="mb-8">
                  {/*
                    O número vem da mesma constante que o catálogo usa.

                    O crachá dizia "14 dias para explorar" enquanto a avaliação
                    é de 30 — dois números diferentes na mesma tela, e o menor
                    deles era o que a pessoa levava para a decisão.
                  */}
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    {TRIAL_DAYS} dias grátis no Essencial
                  </span>
                  <h2 className="mt-4 font-display text-3xl font-bold tracking-tight">
                    {steps[step].title}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {step === 0 &&
                      "Escolha o plano que a sua organização vai assinar."}
                    {step === 1 &&
                      "Crie suas credenciais de acesso administrativo."}
                    {step === 2 &&
                      "Dê um nome ao ambiente que sua equipe verá todos os dias."}
                    {step === 3 &&
                      "Cadastre a matriz para contextualizar sua operação."}
                  </p>
                </div>

                {step > 0 && plan ? (
                  <div
                    className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"
                    aria-label="Plano selecionado"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Plano selecionado
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        {plan.label} ·{" "}
                        {BILLING_INTERVAL_LABELS[billingInterval]}
                      </p>
                      <p className="mt-1 text-sm">
                        {formatCentavos(
                          plan.prices[billingInterval]!.amountMinor,
                        )}{" "}
                        {billingInterval === "MONTHLY"
                          ? "por mês"
                          : billingInterval === "SEMIANNUAL"
                            ? "por semestre"
                            : "por ano"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep(0)}
                      disabled={isSubmitting}
                    >
                      Alterar plano
                    </Button>
                  </div>
                ) : null}

                {step === 0 && (
                  <PlanStep
                    catalog={catalog}
                    selected={selectedPlan}
                    billingInterval={billingInterval}
                    onIntervalChange={(interval) =>
                      setValue("billingInterval", interval, {
                        shouldValidate: true,
                      })
                    }
                    onSelect={(planKey) =>
                      setValue("planKey", planKey, { shouldValidate: true })
                    }
                    error={errors.planKey?.message}
                  />
                )}

                {step === 1 && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Nome</Label>
                      <Input
                        id="firstName"
                        autoComplete="given-name"
                        {...register("firstName")}
                      />
                      <FieldError message={errors.firstName?.message} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Sobrenome</Label>
                      <Input
                        id="lastName"
                        autoComplete="family-name"
                        {...register("lastName")}
                      />
                      <FieldError message={errors.lastName?.message} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="email">E-mail corporativo</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        {...register("email")}
                      />
                      <FieldError message={errors.email?.message} />
                    </div>
                    {(["password", "confirmPassword"] as const).map((name) => (
                      <div key={name} className="space-y-2">
                        <Label htmlFor={name}>
                          {name === "password" ? "Senha" : "Confirmar senha"}
                        </Label>
                        <div className="relative">
                          <Input
                            id={name}
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            className="pr-10"
                            {...register(name)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                            aria-label="Alternar visibilidade da senha"
                          >
                            {showPassword ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </button>
                        </div>
                        <FieldError message={errors[name]?.message} />
                      </div>
                    ))}
                  </div>
                )}

                {step === 2 && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="organizationName">
                        Nome da organização
                      </Label>
                      <Input
                        id="organizationName"
                        placeholder="Como sua equipe conhece a empresa"
                        {...register("organizationName")}
                      />
                      <FieldError message={errors.organizationName?.message} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="legalName">Razão social</Label>
                      <Input id="legalName" {...register("legalName")} />
                      <FieldError message={errors.legalName?.message} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="documentNumber">
                        CPF ou CNPJ
                        {detectBrazilianDocumentType(documentNumber ?? "")
                          ? ` (${detectBrazilianDocumentType(documentNumber ?? "")})`
                          : ""}
                      </Label>
                      <Input
                        id="documentNumber"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00 ou 00.000.000/0000-00"
                        maxLength={18}
                        {...register("documentNumber", {
                          onChange: (event) => {
                            setValue(
                              "documentNumber",
                              formatBrazilianDocument(event.target.value),
                              { shouldDirty: true, shouldValidate: true },
                            );
                          },
                        })}
                      />
                      <FieldError message={errors.documentNumber?.message} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="primarySegment">Segmento principal</Label>
                      <Input
                        id="primarySegment"
                        {...register("primarySegment")}
                      />
                      <FieldError message={errors.primarySegment?.message} />
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="grid gap-5 sm:grid-cols-[1fr_6rem]">
                    {/*
                     * O CEP preenche cidade, UF e endereço — e não viaja no
                     * cadastro: o contrato de criação da organização não tem
                     * campo para ele, e o `ValidationPipe` recusa o que não
                     * está declarado. Aqui ele serve só para poupar digitação.
                     */}
                    <PostalCodeField
                      id="cadastro-cep"
                      className="sm:col-span-2"
                      value={cep}
                      onChange={setCep}
                      onAddressFound={(endereco: PostalAddress) => {
                        const preencher = (
                          campo: "city" | "stateCode" | "street",
                          valor: string,
                        ) => {
                          if (valor) {
                            setValue(campo, valor, { shouldValidate: true });
                          }
                        };
                        preencher("city", endereco.city);
                        preencher("stateCode", endereco.stateCode);
                        preencher("street", endereco.street);
                      }}
                    />

                    <div className="space-y-2">
                      <Label htmlFor="city">Cidade</Label>
                      <Input id="city" {...register("city")} />
                      <FieldError message={errors.city?.message} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stateCode">UF</Label>
                      <Input
                        id="stateCode"
                        maxLength={2}
                        className="uppercase"
                        {...register("stateCode")}
                      />
                      <FieldError message={errors.stateCode?.message} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="street">Endereço da matriz</Label>
                      <Input id="street" {...register("street")} />
                      <FieldError message={errors.street?.message} />
                    </div>
                    <div className="sm:col-span-2">
                      <LegalDocumentsPanel compact />
                    </div>
                    <div className="rounded-xl border border-border bg-muted/40 p-4 sm:col-span-2">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="terms"
                          checked={termsAccepted}
                          onCheckedChange={(checked) =>
                            setValue("terms", checked === true, {
                              shouldValidate: true,
                            })
                          }
                        />
                        <Label
                          htmlFor="terms"
                          className="text-sm font-normal leading-relaxed"
                        >
                          Aceito os Termos de Uso e declaro que li a Política de
                          Privacidade do Orbit, versão {LEGAL_DOCUMENT_VERSION}.
                        </Label>
                      </div>
                      <FieldError message={errors.terms?.message} />
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0 || isSubmitting}
                onClick={() => setStep((current) => Math.max(current - 1, 0))}
              >
                <ArrowLeft className="size-4" />
                Voltar
              </Button>
              {step < LAST_STEP ? (
                <Button key="next-step" type="submit" size="lg">
                  Continuar
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  key="submit-registration"
                  type="submit"
                  size="lg"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Criar organização
                </Button>
              )}
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
