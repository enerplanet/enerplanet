import { useTranslation } from "@spatialhub/i18n";

interface TransformerCursorOverlayProps {
  isAddTransformerMode: boolean;
  isMoveTransformerMode: boolean;
  cursorPos: { x: number; y: number } | null;
}

export const TransformerCursorOverlay = ({
  isAddTransformerMode,
  isMoveTransformerMode,
  cursorPos,
}: TransformerCursorOverlayProps) => {
  const { t } = useTranslation();

  if (!(isAddTransformerMode || isMoveTransformerMode) || !cursorPos) return null;

  return (
    <div
      className="fixed pointer-events-none z-[9999] flex flex-col items-center"
      style={{
        left: cursorPos.x,
        top: cursorPos.y,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex w-9 h-9 rounded-full bg-primary/30 animate-ping" />
        <span className="relative flex items-center justify-center w-8 h-8 rounded-full bg-card border-2 border-primary shadow-lg">
          <img
            src="/images/transformer-icon-dark.svg"
            alt=""
            className="w-4 h-4 dark:invert"
          />
        </span>
      </div>
      <span className="mt-1.5 px-2 py-0.5 rounded-full bg-card/95 border border-border/50 shadow text-[10px] font-medium text-foreground whitespace-nowrap">
        {isMoveTransformerMode
          ? t("simulation.transformer.clickToMove", "Click to move")
          : t("simulation.transformer.clickToPlaceCursor", "Click to place")}
      </span>
    </div>
  );
};
