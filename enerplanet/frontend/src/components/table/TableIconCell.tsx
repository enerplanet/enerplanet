import React from 'react';

interface TableIconCellProps {
    icon: React.ReactNode;
    text: string | null | undefined;
    emptyPlaceholder?: string;
}

/** Displays an icon with text in a table cell; shows a placeholder when text is empty. */
export const TableIconCell: React.FC<TableIconCellProps> = ({
    icon,
    text,
    emptyPlaceholder = "-"
}) => (
    <div className="text-sm text-foreground flex items-center gap-1">
        {text ? (
            <>
                {icon}
                {text}
            </>
        ) : (
            <span className="text-muted-foreground">{emptyPlaceholder}</span>
        )}
    </div>
);
