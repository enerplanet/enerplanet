import React from "react";
import { Thermometer, Ruler, Wind, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDataDisplayStore } from "@/features/settings/store/data-display";
import { useTranslation } from "@spatialhub/i18n";

const OptionButton: React.FC<{
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}> = ({ active, onClick, children }) => (
	<button
		onClick={onClick}
		className={cn(
			"px-2 py-1 text-[10px] font-medium rounded transition-all duration-200",
			active
				? "bg-primary text-primary-foreground"
				: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
		)}
	>
		{children}
	</button>
);

const DataDisplaySettings: React.FC = () => {
	const { t } = useTranslation();
	const { temperatureUnit, distanceUnit, windSpeedUnit, refreshInterval, setPreference } = useDataDisplayStore();

	return (
		<div className="space-y-3">
			{/* Temperature */}
			<div className="space-y-1">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Thermometer className="w-3 h-3" />
					<span>{t('settings.dataDisplay.temperature')}</span>
				</div>
				<div className="flex gap-1.5">
					<OptionButton
						active={temperatureUnit === "celsius"}
						onClick={() => setPreference("temperatureUnit", "celsius")}
					>
						°C {t('settings.dataDisplay.celsius')}
					</OptionButton>
					<OptionButton
						active={temperatureUnit === "fahrenheit"}
						onClick={() => setPreference("temperatureUnit", "fahrenheit")}
					>
						°F {t('settings.dataDisplay.fahrenheit')}
					</OptionButton>
				</div>
			</div>

			{/* Distance */}
			<div className="space-y-1">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Ruler className="w-3 h-3" />
					<span>{t('settings.dataDisplay.distance')}</span>
				</div>
				<div className="flex gap-1.5">
					<OptionButton
						active={distanceUnit === "kilometers"}
						onClick={() => setPreference("distanceUnit", "kilometers")}
					>
						{t('settings.dataDisplay.kilometers')}
					</OptionButton>
					<OptionButton
						active={distanceUnit === "miles"}
						onClick={() => setPreference("distanceUnit", "miles")}
					>
						{t('settings.dataDisplay.miles')}
					</OptionButton>
				</div>
			</div>

			{/* Wind Speed */}
			<div className="space-y-1">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Wind className="w-3 h-3" />
					<span>{t('settings.dataDisplay.windSpeed')}</span>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{[
						{ value: "kmh" as const, label: "km/h" },
						{ value: "mph" as const, label: "mph" },
						{ value: "ms" as const, label: "m/s" },
						{ value: "knots" as const, label: t('settings.dataDisplay.knots') },
					].map((unit) => (
						<OptionButton
							key={unit.value}
							active={windSpeedUnit === unit.value}
							onClick={() => setPreference("windSpeedUnit", unit.value)}
						>
							{unit.label}
						</OptionButton>
					))}
				</div>
			</div>

			{/* Refresh Interval */}
			<div className="space-y-1 pt-2 border-t border-border">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Clock className="w-3 h-3" />
					<span>{t('settings.dataDisplay.dataRefresh')}</span>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{[1, 5, 10, 15].map((mins) => (
						<OptionButton
							key={mins}
							active={refreshInterval === mins}
							onClick={() => setPreference("refreshInterval", mins)}
						>
							{mins} {t('settings.dataDisplay.min')}
						</OptionButton>
					))}
				</div>
			</div>
		</div>
	);
};

export default DataDisplaySettings;
