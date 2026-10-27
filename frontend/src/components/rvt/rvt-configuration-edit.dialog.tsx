"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { RvtConfiguration } from "@/types/rvt";
import { RvtConfigurationForm } from "./rvt-configuration.dialog";

export function RvtConfigurationEditDialog({
  configuration,
  open,
  onOpenChange,
}: {
  configuration: RvtConfiguration;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        {open && (
          <RvtConfigurationForm
            configuration={configuration}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
