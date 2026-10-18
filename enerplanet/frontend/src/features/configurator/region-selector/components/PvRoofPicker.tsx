import { useEffect, useState, type FC } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import axios from "@/lib/axios";

/** One PV array on a roof surface, as the backend stores it in pv_supply.arrays. */
export interface PvArray {
  surface_id: string;
  tilt: number;
  azimuth: number;
  area: number;
  usable_share: number;
}

interface PvRoof extends PvArray {
  qualifies: boolean;
}

interface PvRoofPickerProps {
  osmId: string;
  lonLat: [number, number] | null;
  /** The building's stored arrays; null while placement is automatic. */
  value: PvArray[] | null;
  onChange: (arrays: PvArray[] | null) => void;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const compass = (azimuth: number): string => COMPASS[Math.round(azimuth / 45) % 8];

/** Lists a building's roof surfaces and which carry PV, with each array's usable share. */
export const PvRoofPicker: FC<PvRoofPickerProps> = ({ osmId, lonLat, value, onChange }) => {
  const { t } = useTranslation();
  const [roofs, setRoofs] = useState<PvRoof[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!lonLat) return;
    let cancelled = false;
    axios
      .get<{ roofs: PvRoof[] }>("/v1/city2tabula/pv-roofs", { params: { osm_id: osmId, lon: lonLat[0], lat: lonLat[1] } })
      .then((res) => !cancelled && setRoofs(res.data.roofs))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [osmId, lonLat]);

  const selected = value ?? roofs?.filter((r) => r.qualifies) ?? [];
  const arrayOf = (id: string) => selected.find((a) => a.surface_id === id);
  const toArray = (r: PvRoof): PvArray => ({ surface_id: r.surface_id, tilt: r.tilt, azimuth: r.azimuth, area: r.area, usable_share: r.usable_share });

  const toggle = (roof: PvRoof, on: boolean) =>
    onChange(on ? [...selected, toArray(roof)] : selected.filter((a) => a.surface_id !== roof.surface_id));

  const setShare = (id: string, percent: number) =>
    onChange(selected.map((a) => (a.surface_id === id ? { ...a, usable_share: Math.min(1, Math.max(0, percent / 100)) } : a)));

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("technologies.pvRoofs.title")}</h4>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-xs text-primary hover:underline cursor-pointer">
            {t("technologies.pvRoofs.automatic")}
          </button>
        )}
      </div>
      {!roofs && !failed && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {failed && <p className="text-xs text-muted-foreground">{t("technologies.pvRoofs.unavailable")}</p>}
      {roofs?.length === 0 && <p className="text-xs text-muted-foreground">{t("technologies.pvRoofs.noRoofs")}</p>}
      {roofs && roofs.length > 0 && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {roofs.map((roof, i) => {
              const array = arrayOf(roof.surface_id);
              return (
                <tr key={roof.surface_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="text-foreground">{t("technologies.pvRoofs.roof", { number: i + 1 })}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("technologies.pvRoofs.details", {
                        area: Math.round(roof.area),
                        tilt: Math.round(roof.tilt),
                        direction: compass(roof.azimuth),
                      })}
                    </p>
                  </td>
                  <td className="px-3 py-2 w-24">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={array ? Math.round(array.usable_share * 100) : ""}
                      disabled={!array}
                      aria-label={t("technologies.pvRoofs.usableShare")}
                      onChange={(e) => setShare(roof.surface_id, Number.parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-background border border-border rounded text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2 w-12 text-right">
                    <Switch checked={!!array} onCheckedChange={(on) => toggle(roof, on)} aria-label={t("technologies.pvRoofs.use")} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
