import { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { Loader2, X, LucideIcon } from "lucide-react";

interface TechnologyActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor?: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  isLoading?: boolean;
  isConfirmDisabled?: boolean;
  maxWidth?: string;
  showFooter?: boolean;
}

export function TechnologyActionModal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  iconColor = "bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-200 dark:to-gray-400",
  children,
  confirmLabel = "Confirm",
  onConfirm,
  isLoading = false,
  isConfirmDisabled = false,
  maxWidth = "sm:max-w-md",
  showFooter = true,
}: Readonly<TechnologyActionModalProps>) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent className={`${maxWidth} p-5`}>
        <AlertDialogDescription className="sr-only">{description}</AlertDialogDescription>
        <Button
          disabled={isLoading}
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="absolute z-10 right-3 top-3 size-8 justify-center items-center flex cursor-pointer rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X className="size-4" />
        </Button>

        <AlertDialogHeader className="pr-10">
          <AlertDialogTitle className="flex items-center gap-2.5 text-xl">
            <span className={`w-9 h-9 ${iconColor} rounded-xl flex items-center justify-center shadow-lg`}>
              <Icon className="w-4.5 h-4.5 text-white dark:text-gray-900" />
            </span>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-1">{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4">
          {children}
        </div>

        {showFooter && (
          <AlertDialogFooter className="gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={isLoading}
              onClick={onClose}
              className="rounded-xl cursor-pointer text-sm h-10 px-5 font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </Button>
            {onConfirm && (
              <Button
                variant="default"
                disabled={isLoading || isConfirmDisabled}
                onClick={onConfirm}
                className="rounded-xl cursor-pointer text-sm h-10 px-6 font-medium min-w-[calc(var(--spacing)_*_20)] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmLabel}
              </Button>
            )}
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
