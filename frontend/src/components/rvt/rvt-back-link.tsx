import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

export function RvtBackLink() {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`${ROUTES.operations}?secao=rvt`}>
        <ArrowLeft className="size-4" />
        Voltar para RVT
      </Link>
    </Button>
  );
}
