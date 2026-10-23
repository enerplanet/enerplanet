import { useEffect, useState, type FC } from "react";
import { Box } from "lucide-react";
import { toLonLat } from "ol/proj";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { withCartoBasemapKey } from "@/utils/carto-basemap";
import { cn } from "@/lib/utils";

/** Zoom of the preview tiles: a few streets, enough to tell the styles apart. */
const PREVIEW_ZOOM = 15;

/** Web Mercator tile holding lon/lat at zoom z. */
const tileAt = (lon: number, lat: number, z: number) => {
	const n = 2 ** z;
	const rad = (lat * Math.PI) / 180;
	return {
		x: Math.floor(((lon + 180) / 360) * n),
		y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
	};
};

const previewUrl = (layerId: string, x: number, y: number): string | null => {
	if (layerId === "osm_standard") return `https://tile.openstreetmap.org/${PREVIEW_ZOOM}/${x}/${y}.png`;
	if (layerId === "carto_dark") return withCartoBasemapKey(`https://a.basemaps.cartocdn.com/dark_all/${PREVIEW_ZOOM}/${x}/${y}.png`);
	return null;
};

/**
 * Base map choice as small preview tiles on the map, bottom right. The visible
 * tile switches straight to the other everyday view (2D map or 3D); pointing at
 * it shows every base map.
 */
export const BaseLayerSwitcher: FC = () => {
	const map = useMapStore((s) => s.map);
	const layers = useMapStore((s) => s.layers);
	const selectedId = useMapStore((s) => s.selectedBaseLayerId);
	const select = useMapStore((s) => s.setSelectedBaseLayerId);
	const [tile, setTile] = useState<{ x: number; y: number } | null>(null);

	useEffect(() => {
		if (!map) return;
		const update = () => {
			const center = map.getView().getCenter();
			if (!center) return;
			const [lon, lat] = toLonLat(center);
			setTile(tileAt(lon, lat, PREVIEW_ZOOM));
		};
		update();
		map.on("moveend", update);
		return () => map.un("moveend", update);
	}, [map]);

	const quickId = selectedId === "osm_standard" ? "maplibre_3d" : "osm_standard";
	const quick = layers.find((l) => l.id === quickId);
	if (!quick) return null;
	const others = layers.filter((l) => l.id !== quickId);

	const tileButton = (layer: (typeof layers)[number]) => {
		const url = tile ? previewUrl(layer.id, tile.x, tile.y) : null;
		const active = layer.id === selectedId;
		return (
			<button
				key={layer.id}
				type="button"
				onClick={() => select(layer.id)}
				aria-pressed={active}
				title={layer.description}
				className={cn(
					"relative h-16 w-16 overflow-hidden rounded-lg border-2 bg-muted shadow-md transition-transform hover:scale-105",
					active ? "border-primary" : "border-card"
				)}
			>
				{url ? (
					<img src={url} alt="" className="h-full w-full object-cover" />
				) : (
					<span className="flex h-full w-full items-center justify-center bg-slate-700 text-white">
						<Box className="h-6 w-6" aria-hidden="true" />
					</span>
				)}
				<span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[11px] font-medium text-white">
					{layer.name}
				</span>
			</button>
		);
	};

	return (
		<div
			className="group absolute z-30 flex items-end gap-2"
			// Above the attribution line and the 3D rotate hint in the bottom-right corner.
			style={{ right: "calc(1rem + var(--sidebar-offset, 0rem))", bottom: "4.5rem" }}
		>
			<div className="hidden gap-2 rounded-xl bg-card/90 p-1.5 shadow-lg group-focus-within:flex group-hover:flex">
				{others.map(tileButton)}
			</div>
			{tileButton(quick)}
		</div>
	);
};
