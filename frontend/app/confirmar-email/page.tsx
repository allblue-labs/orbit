import type { Metadata } from "next";
import { ConfirmEmail } from "@/components/auth/confirm-email";

export const metadata: Metadata = {
  title: "Confirme seu e-mail | Orbit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConfirmEmailPage() {
  return <ConfirmEmail />;
}
