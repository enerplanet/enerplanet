import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@spatialhub/ui";
import { AlertTriangle } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "@spatialhub/i18n";

interface UnsavedChangesDialogProps {
  open: boolean;
  onContinue: () => void;
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
}

export const UnsavedChangesDialog: FC<UnsavedChangesDialogProps> = ({
  open,
  onContinue,
  onDiscard,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            {t("simulation.unsavedChanges.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("simulation.unsavedChanges.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="default" className="w-full cursor-pointer" onClick={onContinue}>
            {t("simulation.unsavedChanges.continueEditing")}
          </Button>
          <Button variant="destructive" className="w-full cursor-pointer" onClick={onDiscard}>
            {t("simulation.unsavedChanges.discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
