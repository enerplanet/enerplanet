import { useState, useCallback } from 'react';

/** Hook for dialog/modal state with optional selected item. */
export const useDialog = <T = null>() => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<T | null>(null);

    /** Open dialog, optionally setting selected item */
    const open = useCallback((item?: T) => {
        if (item !== undefined) {
            setSelectedItem(item);
        }
        setIsOpen(true);
    }, []);

    /** Close dialog and clear selected item */
    const close = useCallback(() => {
        setIsOpen(false);
        setSelectedItem(null);
    }, []);

    /** Toggle dialog; when closing, clear selected item */
    const toggle = useCallback(() => {
        setIsOpen(prev => {
            if (prev) {
                setSelectedItem(null);
            }
            return !prev;
        });
    }, []);

    return {
        isOpen,
        selectedItem,
        open,
        close,
        toggle,
        setSelectedItem, // For manual control if needed
    };
};
