import type { FC } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { useWeatherArchives } from "@/features/configurator/hooks/useWeatherYears";
import type { WeatherChoice } from "@/features/configurator/hooks/useAreaSelect/helpers/weatherSettings";

// Archive names as weather-serve lists them, with their published names.
const ARCHIVE_NAMES: Record<string, string> = {
  "merra-2": "MERRA-2",
  "era5-land": "ERA5-Land",
  "cosmo-rea6": "COSMO-REA6",
};

const CHOICES: WeatherChoice[] = ["p50", "p10", "p90", "year"];

/**
 * The weather a model's runs use, for experts: the archive, and a scenario year
 * (typical, low or high solar) or the real weather of the period's year.
 */
export const WeatherSettings: FC<{ periodYear: number | undefined }> = ({ periodYear }) => {
  const { t } = useTranslation();
  const weather = useModelStore((s) => s.weather);
  const setWeather = useModelStore((s) => s.setWeather);
  const { defaultProvider, archives } = useWeatherArchives();
  const archive = weather.provider ?? defaultProvider ?? "";
  const names = Object.keys(archives);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-tour="weather">
      <p className="text-sm font-medium text-foreground">{t("simulation.weather.title")}</p>

      <div>
        <label htmlFor="weather-archive-select" className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("simulation.weather.archive")}
        </label>
        <Select value={archive} onValueChange={(value: string) => setWeather({ ...weather, provider: value === defaultProvider ? null : value })}>
          <SelectTrigger id="weather-archive-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {names.map((name) => (
              <SelectItem key={name} value={name}>
                {ARCHIVE_NAMES[name] ?? name} · {archives[name][0]}–{archives[name].at(-1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label htmlFor="weather-year-select" className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("simulation.weather.year")}
        </label>
        <Select value={weather.choice} onValueChange={(value: string) => setWeather({ ...weather, choice: value as WeatherChoice })}>
          <SelectTrigger id="weather-year-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {t(`simulation.weather.choices.${choice}`, { year: periodYear ?? "" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{t(`simulation.weather.hints.${weather.choice === "year" ? "year" : "scenario"}`)}</p>
      </div>
    </div>
  );
};
