import { createContext, useContext, useState, ReactNode, useRef, useLayoutEffect, useMemo, useCallback } from "react";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
} from "@spatialhub/ui";
import { LoadingDots } from "@/components/ui/loading";
import {
	IconAlertTriangle,
	IconCircleCheck,
	IconExclamationCircle,
	IconInfoCircle,
	IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type ConfirmType = "success" | "info" | "warning" | "error" | "delete" | "default";
const DEFAULT_TITLE = "Confirm Action" as const;
const DEFAULT_DESC = "This action cannot be undone." as const;

interface ConfirmOptions {
	title?: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	type?: ConfirmType;
	onConfirm?: () => Promise<void>;
	itemName?: string;
	itemType?: string;
	isDangerous?: boolean;
}

interface ConfirmContextValue {
	confirm: (options: ConfirmOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
	const [isOpen, setIsOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [options, setOptions] = useState<ConfirmOptions>({ title: DEFAULT_TITLE, description: DEFAULT_DESC, type: "default" });
	const [resolveFn, setResolveFn] = useState<(() => void) | null>(null);
	const confirmButtonRef = useRef<HTMLButtonElement>(null);

	useLayoutEffect(() => {
		if (isOpen && confirmButtonRef.current) {
			confirmButtonRef.current.focus();
		}
	}, [isOpen]);



	const confirm = useCallback((opts: ConfirmOptions) => {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}

		const finalOptions = { ...opts };

		if (opts.type === 'delete') {
			const itemName = opts.itemName;
			const itemType = opts.itemType || 'item';
			
			if (!opts.title) {
				finalOptions.title = `Delete ${itemType}?`;
			}
			
			if (!opts.description) {
				finalOptions.description = itemName 
					? `Are you sure you want to delete "${itemName}"? This action cannot be undone.`
					: `Are you sure you want to delete this ${itemType}? This action cannot be undone.`;
			}
			
			if (!opts.confirmLabel) {
				finalOptions.confirmLabel = 'Delete';
			}
			
			if (!opts.cancelLabel) {
				finalOptions.cancelLabel = 'Cancel';
			}
		}
		
		setOptions(finalOptions);
		setIsOpen(true);

		return new Promise<void>((resolve) => {
			setResolveFn(() => resolve);
		});
	}, []);

	const handleConfirm = async () => {
		try {
			setLoading(true);
			await options.onConfirm?.();
		} finally {
			setLoading(false);
			setIsOpen(false);
			resolveFn?.();
		}
	};

	const handleCancel = () => {
		if (loading) return;
		setIsOpen(false);
	};

	const onOpenChange = (open: boolean) => {
		if (!loading) {
			setIsOpen(open);
		}
	};

	const confirmValue = useMemo(() => ({ confirm }), [confirm]);

	const isDestructive = options.type === 'delete' || options.type === 'error';

	return (
		<ConfirmContext.Provider value={confirmValue}>
			{children}
			<AlertDialog open={isOpen} onOpenChange={onOpenChange}>
				<AlertDialogContent className="p-0 overflow-hidden max-w-xs">
					{/* Close button */}
					<button
						type="button"
						onClick={handleCancel}
						disabled={loading}
						className="absolute right-3 top-3 z-10 p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
					>
						<IconX className="w-3.5 h-3.5" />
					</button>

					{/* Content */}
					<div className="px-4 pt-4 pb-3">
						<div className="flex items-start gap-3">
							{options.type && <AlertBadge type={options.type} />}
							<AlertDialogHeader className="space-y-1 flex-1 min-w-0">
								<AlertDialogTitle className="text-base font-semibold text-gray-900 dark:text-gray-100 pr-4">
									{options.title}
								</AlertDialogTitle>
								<AlertDialogDescription className={cn(
									"text-sm text-gray-500 dark:text-gray-400 leading-relaxed",
									options.description ? "" : "sr-only"
								)}>
									{options.description || options.title || "Confirmation dialog"}
								</AlertDialogDescription>
							</AlertDialogHeader>
						</div>
					</div>

					{/* Footer */}
					<AlertDialogFooter className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 gap-2 sm:gap-2">
						<Button 
							variant="ghost" 
							disabled={loading} 
							onClick={handleCancel} 
							className="rounded-lg cursor-pointer text-sm h-9 px-4 font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
						>
							{options.cancelLabel || "Cancel"}
						</Button>
						<Button
							ref={confirmButtonRef}
							autoFocus
							variant={isDestructive ? 'destructive' : 'default'}
							disabled={loading}
							onClick={handleConfirm}
							className={cn(
								"rounded-lg cursor-pointer text-sm h-9 px-4 font-medium min-w-[80px]",
								"transition-all duration-200",
								isDestructive 
									? "bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700" 
									: "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
							)}
						>
							{loading ? <LoadingDots className={isDestructive ? "bg-white" : "bg-white dark:bg-gray-900"} /> : options.confirmLabel || "Confirm"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ConfirmContext.Provider>
	);
};

 
export const useConfirm = () => {
	const context = useContext(ConfirmContext);
	if (!context) throw new Error("useConfirm must be used within ConfirmProvider");
	return context.confirm;
};

const AlertBadge: React.FC<{ type: ConfirmType }> = ({ type }) => {
	const baseClasses = "flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0";
	
	switch (type) {
		case "success":
			return (
				<div className={cn(baseClasses, "bg-green-100 dark:bg-green-900/30")}>
					<IconCircleCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
				</div>
			);

		case "error":
			return (
				<div className={cn(baseClasses, "bg-red-100 dark:bg-red-900/30")}>
					<IconExclamationCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
				</div>
			);

		case "info":
			return (
				<div className={cn(baseClasses, "bg-blue-100 dark:bg-blue-900/30")}>
					<IconInfoCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
				</div>
			);

		case "delete":
			return (
				<div className={cn(baseClasses, "bg-red-100 dark:bg-red-900/30")}>
					<IconAlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
				</div>
			);

		case "warning":
			return (
				<div className={cn(baseClasses, "bg-amber-100 dark:bg-amber-900/30")}>
					<IconAlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
				</div>
			);

		default:
			return (
				<div className={cn(baseClasses, "bg-gray-100 dark:bg-gray-800")}>
					<IconAlertTriangle className="w-4 h-4 text-gray-600 dark:text-gray-400" />
				</div>
			);
	}
};
