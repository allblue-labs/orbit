import { Check, Circle } from "lucide-react";

import { PASSWORD_REQUIREMENTS } from "@/lib/password-policy";

export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul
      aria-label="Requisitos da senha"
      className="space-y-1 text-xs text-muted-foreground"
    >
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = requirement.test(password);
        const Icon = met ? Check : Circle;

        return (
          <li
            key={requirement.id}
            className={met ? "flex items-center gap-2 text-emerald-500" : "flex items-center gap-2"}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {requirement.label}
            <span className="sr-only">{met ? "Atendido" : "Pendente"}</span>
          </li>
        );
      })}
    </ul>
  );
}
