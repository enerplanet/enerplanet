import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, RotateCcw, Building2, Loader2 } from "lucide-react";
import { usePolygonLimitsStore, POLYGON_LIMIT_OPTIONS, ACCESS_LEVELS, ACCESS_LEVEL_LABELS, type AccessLevel } from "@/features/polygon-drawer/store/polygon-limits-store";
import { useAuthStore } from "@/store/auth-store";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import Notification from "@/components/ui/Notification";
import { useTranslation } from "@spatialhub/i18n";

interface LimitDropdownProps {
	value: number;
	onChange: (value: number) => Promise<boolean>;
	label: string;
	disabled?: boolean;
	onSuccess: (message: string) => void;
	onError: (message: string) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

const LimitDropdown: React.FC<LimitDropdownProps> = ({ value, onChange, label, disabled, onSuccess, onError, t }) => {
	const [isOpen, setIsOpen] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	const formatLimit = (limit: number) => limit === 0 ? t('settings.polygonLimits.unlimited') : `${limit}`;

	const handleChange = async (val: number) => {
		setIsUpdating(true);
		const success = await onChange(val);
		setIsUpdating(false);
		setIsOpen(false);
		
		if (success) {
			onSuccess(t('settings.polygonLimits.limitUpdated', { label, value: formatLimit(val) }));
		} else {
			onError(t('settings.polygonLimits.failedToUpdate', { label }));
		}
	};

	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-xs text-foreground">{label}</span>
			<div className="relative" ref={dropdownRef}>
				<button
					onClick={() => !disabled && setIsOpen(!isOpen)}
					disabled={disabled || isUpdating}
					className="flex items-center gap-2 px-2.5 py-1.5 bg-card border border-border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200 min-w-[90px] disabled:opacity-50 text-xs"
				>
					<div className="flex items-center justify-center w-5 h-5 bg-muted rounded">
						{isUpdating ? (
							<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
						) : (
							<Building2 className="w-3 h-3 text-muted-foreground" />
						)}
					</div>
					<span className="font-normal text-foreground flex-1 text-left">
						{formatLimit(value)}
					</span>
					<ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
				</button>

				{isOpen && (
					<div className="absolute top-full right-0 mt-1.5 w-36 bg-card border border-border rounded-lg shadow-lg z-[9999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
						<div className="max-h-56 overflow-y-auto p-1.5">
							<div className="space-y-0.5">
								{POLYGON_LIMIT_OPTIONS.map((opt) => {
									const isSelected = value === opt;
									return (
										<button
											key={opt}
											onClick={() => handleChange(opt)}
											className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md transition-all duration-150 text-left text-xs hover:bg-muted ${
												isSelected ? 'bg-muted font-semibold' : 'font-medium'
											}`}
										>
											<span className="text-foreground">{formatLimit(opt)}</span>
											{isSelected && <Check className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
										</button>
									);
								})}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

const PolygonLimitsSettings: React.FC = () => {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const { limits, isLoading, setLimitForLevel, resetToDefaults, getEffectiveLimit, fetchLimits } = usePolygonLimitsStore();
	const [isResetting, setIsResetting] = useState(false);
	const { notification, showSuccess, showError, hide } = useNotification();
	
	const accessLevel = (user?.access_level ?? 'very_low') as AccessLevel;
	const isExpert = accessLevel === 'expert';
	const currentLimit = getEffectiveLimit(accessLevel);

	// Access level label translations
	const getAccessLevelLabel = (level: AccessLevel) => {
		const labels: Record<AccessLevel, string> = {
			very_low: t('settings.polygonLimits.levels.basic'),
			intermediate: t('settings.polygonLimits.levels.intermediate'),
			manager: t('settings.polygonLimits.levels.manager'),
			expert: t('settings.polygonLimits.levels.expert'),
		};
		return labels[level] || ACCESS_LEVEL_LABELS[level];
	};

	// Fetch limits on mount
	useEffect(() => {
		fetchLimits();
	}, [fetchLimits]);

	const handleReset = async () => {
		setIsResetting(true);
		const success = await resetToDefaults();
		setIsResetting(false);
		if (success) {
			showSuccess(t('settings.polygonLimits.resetSuccess'));
		} else {
			showError(t('settings.polygonLimits.resetFailed'));
		}
	};

	return (
		<div className="space-y-2">
			{notification.open && (
				<Notification
					isOpen={notification.open}
					severity={notification.severity}
					message={notification.message}
					onClose={hide}
				/>
			)}
			
			{/* Current user limit */}
			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">{t('settings.polygonLimits.yourLimit')}</span>
				<span className="font-medium text-foreground px-1.5 py-0.5 bg-muted rounded text-[10px]">
				{(() => {
					if (isLoading) return '...';
					if (currentLimit === 0) return t('settings.polygonLimits.unlimited');
					return `${currentLimit}`;
				})()}
				</span>
			</div>

			{/* Expert: Configure all levels */}
			{isExpert && (
				<div className="space-y-2 pt-2 border-t border-border">
					<div className="flex items-center justify-between">
						<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
							{t('settings.polygonLimits.byRole')}
						</span>
						<button
							onClick={handleReset}
							disabled={isResetting}
							className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-50"
						>
							{isResetting ? (
								<Loader2 className="w-2.5 h-2.5 animate-spin" />
							) : (
								<RotateCcw className="w-2.5 h-2.5" />
							)}
							{t('settings.polygonLimits.reset')}
						</button>
					</div>
					<div className="space-y-1.5">
						{ACCESS_LEVELS.map((level) => (
							<LimitDropdown
								key={level}
								label={getAccessLevelLabel(level)}
								value={limits[level]}
								onChange={(val) => setLimitForLevel(level, val)}
								disabled={isLoading}
								onSuccess={showSuccess}
								onError={showError}
								t={t}
							/>
						))}
					</div>
				</div>
			)}

			{/* Non-expert info */}
			{!isExpert && (
				<p className="text-[10px] text-muted-foreground">
					{t('settings.polygonLimits.contactAdmin')}
				</p>
			)}
		</div>
	);
};

export default PolygonLimitsSettings;
