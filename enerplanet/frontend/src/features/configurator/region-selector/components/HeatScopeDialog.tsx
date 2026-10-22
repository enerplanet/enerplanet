import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@spatialhub/ui";
import type { FC } from "react";
import { useTranslation } from "@spatialhub/i18n";
import type { HeatScope, HeatScopeRequest } from "@/features/configurator/hooks/useTechDragDrop";

interface HeatScopeDialogProps {
  /** The heat supply waiting for a choice; the dialog is closed while null. */
  request: HeatScopeRequest | null;
  /** The chosen buildings, or null when the user cancels. */
  onChoose: (scope: HeatScope | null) => void;
}

/** Asks which buildings a heat supply added to all goes on, since a building has one heat supply. */
export const HeatScopeDialog: FC<HeatScopeDialogProps> = ({ request, onChoose }) => {
  const { t } = useTranslation();
  if (!request) return null;
  const without = request.total - request.withHeat;
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onChoose(null); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("technologies.heatScope.title", { tech: request.alias })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("technologies.heatScope.description", { withHeat: request.withHeat, without })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={() => onChoose("missing")} disabled={without === 0}>
            {t("technologies.heatScope.missing", { count: without })}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onChoose("replace")}>
            {t("technologies.heatScope.replace", { count: request.total })}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => onChoose(null)}>
            {t("common.cancel")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
