import type { FC } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@spatialhub/ui";
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

      <div role="radiogroup" aria-label={t("simulation.weather.mode.label")} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {[true, false].map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={scenario === option}
            onClick={() => scenario !== option && onModeChange(option)}
            className={cn(
              "h-7 cursor-pointer rounded text-xs font-medium transition-colors",
              scenario === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`simulation.weather.mode.${option ? "scenario" : "year"}`)}
          </button>
        ))}
      </div>

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

/** The weather archive, listing each archive that has years with its range. */
const ArchiveSelect: FC = () => {
  const { t } = useTranslation();
  const weather = useModelStore((s) => s.weather);
  const setWeather = useModelStore((s) => s.setWeather);
  const { defaultProvider, archives } = useWeatherArchives();
  const archive = weather.provider ?? defaultProvider ?? "";

  return (
    <div>
      <label htmlFor="weather-archive-select" className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("simulation.weather.archive")}
      </label>
      <Select value={archive} onValueChange={(value: string) => setWeather({ ...weather, provider: value === defaultProvider ? null : value })}>
        <SelectTrigger id="weather-archive-select" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.keys(archives).map((name) => (
            <SelectItem key={name} value={name}>
              {ARCHIVE_NAMES[name] ?? name} · {archives[name][0]}–{archives[name].at(-1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
