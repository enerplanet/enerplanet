import { useEffect, useState, type FC } from "react";
import { Box } from "lucide-react";
import { toLonLat } from "ol/proj";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useToastStore } from "@/features/notifications/toastStore";

/** Zoom of the preview tile: a few streets, enough to recognise the place. */
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

/**
 * Switches between the 2D map and the 3D view with one preview tile showing
 * the other view, bottom left under the map tools and level with the attribution.
 */
export const BaseLayerSwitcher: FC = () => {
	const map = useMapStore((s) => s.map);
	const layers = useMapStore((s) => s.layers);
	const selectedId = useMapStore((s) => s.selectedBaseLayerId);
	const select = useMapStore((s) => s.setSelectedBaseLayerId);
	const setToastsLifted = useToastStore((s) => s.setLifted);
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

	// Toasts share the bottom-left corner, so they sit above the tile.
	useEffect(() => {
		setToastsLifted(true);
		return () => setToastsLifted(false);
	}, [setToastsLifted]);

	const other = layers.find((l) => l.id !== selectedId);
	if (!other) return null;
	const showsMap = other.id === "osm_standard";

	return (
		<button
			type="button"
			onClick={() => select(other.id)}
			title={other.description}
			className="absolute bottom-4 left-4 z-30 h-16 w-16 overflow-hidden rounded-lg border-2 border-card bg-muted shadow-md transition-transform hover:scale-105"
		>
			{showsMap && tile ? (
				<img src={`https://tile.openstreetmap.org/${PREVIEW_ZOOM}/${tile.x}/${tile.y}.png`} alt="" className="h-full w-full object-cover" />
			) : (
				<span className="flex h-full w-full items-center justify-center bg-slate-700 text-white">
					<Box className="h-6 w-6" aria-hidden="true" />
				</span>
			)}
			<span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[11px] font-medium text-white">
				{other.name}
			</span>
		</button>
	);
};
