import { useEffect, type RefObject } from "react";

/**
 * Closes a dropdown/popover when the user clicks outside the referenced element.
 *
 * @param ref   - React ref attached to the container element
 * @param open  - Whether the dropdown is currently visible
 * @param onClose - Callback to close the dropdown
 */
export function useClickOutside(
    ref: RefObject<HTMLElement | null>,
    open: boolean,
    onClose: () => void,
): void {
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open, ref, onClose]);
}
