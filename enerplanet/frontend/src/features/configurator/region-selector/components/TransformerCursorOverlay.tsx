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
      <img src="/images/transformer-icon-black.svg" alt="" className="w-5 h-5 drop-shadow-md" />
      {isMoveTransformerMode && (
        <span className="text-[10px] font-medium text-black whitespace-nowrap mt-0.5">
          {t("transformer.clickToMove")}
        </span>
      )}
    </div>
  );
};
