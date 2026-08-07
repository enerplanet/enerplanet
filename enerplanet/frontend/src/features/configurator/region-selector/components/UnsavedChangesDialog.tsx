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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Unsaved Changes
          </AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes in this model. Please save manually before leaving or discard
            your changes.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="default" className="w-full cursor-pointer" onClick={onContinue}>
            Continue editing
          </Button>
          <Button variant="destructive" className="w-full cursor-pointer" onClick={onDiscard}>
            Discard changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
