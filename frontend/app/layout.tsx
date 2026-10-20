import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import {
  parseSidebarCookie,
  SIDEBAR_COOKIE,
} from "@/components/layout/sidebar-cookie";
import {
  AVISO_COOKIE,
  avisoFoiDispensado,
} from "@/components/billing/subscription-notice-cookie";
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE,
  parseThemeCookie,
} from "@/components/layout/theme-cookie";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Orbit Design System — Fundação Visual",
  description:
    "Fundação do design system do Orbit Operations ERP: tokens, componentes, layout e motion.",
  openGraph: {
    title: "Orbit Design System — Fundação Visual",
    description:
      "Tokens, biblioteca de componentes e layout base da plataforma Orbit.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  /**
   * O símbolo do Orbit na aba do navegador.
   *
   * Era um `.ico` do logotipo completo — a palavra "Orbit" reduzida a 16px
   * vira um borrão. `app/icon.png` é a convenção do App Router e o Next
   * publica o `<link rel="icon">` a partir dele; a entrada explícita abaixo
   * cobre quem procura `/icon.png` direto.
   */
  icons: { icon: "/icon.png" },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  /**
   * A preferência de menu é lida **no servidor**.
   *
   * É o que faz o primeiro quadro sair com a largura certa. Lida só no
   * cliente, a barra renderizaria expandida no HTML e encolheria na
   * hidratação — que era exatamente o piscar a cada navegação.
   */
  const store = await cookies();
  const theme = parseThemeCookie(store.get(THEME_COOKIE)?.value);
  const sidebarCollapsed = parseSidebarCookie(
    store.get(SIDEBAR_COOKIE)?.value,
  );
  /* Pela mesma razão: saber antes de pintar evita o aviso de assinatura
     aparecer e sumir na frente de quem já o fechou. */
  const avisoDispensado = avisoFoiDispensado(store.get(AVISO_COOKIE)?.value);

  return (
    <html
      lang="pt-BR"
      /*
        A classe do tema sai daqui já pintada quando a escolha é explícita: sem
        isso a página abre clara e escurece depois da hidratação, na frente de
        quem está olhando.

        Em `system` o servidor não tem como saber — quem resolve é o script
        abaixo, antes da primeira pintura.
      */
      className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}${
        theme === "dark" ? " dark" : ""
      }`}
      style={theme === "system" ? undefined : { colorScheme: theme }}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        <Providers
          sidebarCollapsed={sidebarCollapsed}
          theme={theme}
          avisoAssinaturaDispensado={avisoDispensado}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
