import type { FC } from "react";
import { Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { useWeatherArchives } from "@/features/configurator/hooks/useWeatherYears";
import { isScenario, type WeatherChoice } from "@/features/configurator/hooks/useAreaSelect/helpers/weatherSettings";

// Archive names as weather-serve lists them, with their published names.
const ARCHIVE_NAMES: Record<string, string> = {
  "merra-2": "MERRA-2",
  "era5-land": "ERA5-Land",
  "cosmo-rea6": "COSMO-REA6",
};

const SCENARIOS: WeatherChoice[] = ["p50", "p10", "p90"];

interface WeatherSettingsProps {
  /** Shows the archive picker; everyone else runs on the default archive. */
  isExpert: boolean;
  /** Switches between scenario and historic weather; the caller moves the period to fit. */
  onModeChange: (scenario: boolean) => void;
}

/**
 * The weather a model's runs use: a scenario year (typical, low or high solar) or
 * the recorded weather of a historic year, chosen first because it decides how the
 * period's year is set. Experts also pick the archive.
 */
export const WeatherSettings: FC<WeatherSettingsProps> = ({ isExpert, onModeChange }) => {
  const { t } = useTranslation();
  const weather = useModelStore((s) => s.weather);
  const setWeather = useModelStore((s) => s.setWeather);
  const scenario = isScenario(weather);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-tour="weather">
      <p className="text-sm font-medium text-foreground">{t("simulation.weather.title")}</p>

      <ChoiceToggle
        label={t("simulation.weather.mode.label")}
        value={scenario ? "scenario" : "year"}
        options={["scenario", "year"].map((mode) => ({ value: mode, label: t(`simulation.weather.mode.${mode}`) }))}
        onChange={(mode) => onModeChange(mode === "scenario")}
      />

      {scenario ? (
        <div>
          <label htmlFor="weather-scenario-select" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("simulation.weather.year")}
          </label>
          <Select value={weather.choice} onValueChange={(value: string) => setWeather({ ...weather, choice: value as WeatherChoice })}>
            <SelectTrigger id="weather-scenario-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIOS.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {t(`simulation.weather.choices.${choice}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{t("simulation.weather.hints.scenario")}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("simulation.weather.hints.year")}</p>
      )}

      {isExpert && <ArchiveSelect />}
    </div>
  );
};

interface ChoiceOption { value: string; label: string }

/** A row of mutually exclusive choices, one click each. */
const ChoiceToggle: FC<{ label: string; value: string; options: ChoiceOption[]; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => (
  <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-md bg-muted p-1">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => value !== option.value && onChange(option.value)}
        className={cn(
          "h-7 flex-1 cursor-pointer rounded px-2 text-xs font-medium transition-colors",
          value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** The weather archive by name; its coverage is behind the info icon. */
const ArchiveSelect: FC = () => {
  const { t } = useTranslation();
  const weather = useModelStore((s) => s.weather);
  const setWeather = useModelStore((s) => s.setWeather);
  const { defaultProvider, archives } = useWeatherArchives();
  const archive = weather.provider ?? defaultProvider ?? "";
  const names = Object.keys(archives);

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {t("simulation.weather.archive")}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={t("simulation.weather.coverage")} className="cursor-help">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs space-y-1">
            <p className="font-medium">{t("simulation.weather.coverage")}</p>
            {names.map((name) => (
              <p key={name}>
                {ARCHIVE_NAMES[name] ?? name}: {t("simulation.weather.historicYears", { count: archives[name].length, range: yearRange(archives[name]) })}
              </p>
            ))}
          </TooltipContent>
        </Tooltip>
      </div>
      <ChoiceToggle
        label={t("simulation.weather.archive")}
        value={archive}
        options={names.map((name) => ({ value: name, label: ARCHIVE_NAMES[name] ?? name }))}
        onChange={(value) => setWeather({ ...weather, provider: value === defaultProvider ? null : value })}
      />
    </div>
  );
};

/** First and last year, or the one year when they are the same. */
const yearRange = (years: number[]): string => (years.length > 1 ? `${years[0]}–${years.at(-1)}` : String(years[0]));
