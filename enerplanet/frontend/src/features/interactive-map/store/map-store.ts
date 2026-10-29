import { create } from "zustand";
import { Map } from "ol";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import TileWMS from "ol/source/TileWMS";
import { fromLonLat } from "ol/proj";
import { createJSONStorage, persist } from "zustand/middleware";
import { MAP_ZOOM } from '@/features/interactive-map/utils/mapUtils';
import { useMapLocationStore } from './map-location';

// Base layer metadata interface
interface BaseLayerInfo {
	id: string;
	name: string;
	description: string;
	source: OSM | XYZ | TileWMS;
	accessLevel: "very_low" | "intermediate" | "manager" | "expert";
}

interface MapStore {
	map: Map | null;
	zoom: number;
	position: number[];
	setMap: (map: Map) => void;
	setZoom: (zoom: number) => void;
	setPosition: (position: number[]) => void;
	layers: BaseLayerInfo[];
	baseLayer: TileLayer | null;
	setBaseLayer: (layer: TileLayer) => void;
	selectedBaseLayerId: string;
	setSelectedBaseLayerId: (id: string) => void;
	overlayLayers: TileLayer[];
	addOverlayLayer: (layer: TileLayer) => void;
	removeOverlayLayer: (layer: TileLayer) => void;
	clearOverlayLayers: () => void;
	fireRiskOverlay: TileLayer | null;
	setFireRiskOverlay: (layer: TileLayer | null) => void;
}

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Map first: it is the default and the base for drawing.
const baseLayers: BaseLayerInfo[] = [
	{
		id: "osm_standard",
		name: "Map",
		description: "Standard OpenStreetMap layer",
		source: new OSM({
			attributions: [OSM_ATTR],
		}),
		accessLevel: "very_low",
	},
	{
		id: "maplibre_3d",
		name: "3D",
		description: "3D buildings, for viewing",
		source: new XYZ({ url: '' }),
		accessLevel: "very_low",
	},
];

export const useMapStore = create<MapStore>()(
	persist(
		(set, get) => ({
			map: null,
			zoom: MAP_ZOOM.DEFAULT,
			position: [-8.5, 42.8],
			setPosition: (position) => set({ position }),
			setMap: (map) => set({ map }),
			setZoom: (zoom) => set({ zoom }),
			layers: baseLayers,
			baseLayer: null,
			setBaseLayer: (layer) => set({ baseLayer: layer }),
			selectedBaseLayerId: "osm_standard",
			setSelectedBaseLayerId: (id) => set({ selectedBaseLayerId: id }),
			overlayLayers: [],
			addOverlayLayer: (layer) => {
				const { map, overlayLayers } = get();

				if (map && !overlayLayers.includes(layer)) {
					map.addLayer(layer);
					const newOverlayLayers = [...overlayLayers, layer];
					set({ overlayLayers: newOverlayLayers });

					layer.setZIndex(1000);
				}
			},
			removeOverlayLayer: (layer) => {
				const { map, overlayLayers } = get();
				if (map && overlayLayers.includes(layer)) {
					map.removeLayer(layer);
					set({ overlayLayers: overlayLayers.filter(l => l !== layer) });
				}
			},
			clearOverlayLayers: () => {
				const { map, overlayLayers } = get();
				if (map) {
					for (const layer of overlayLayers) {
						map.removeLayer(layer);
					}
					set({ overlayLayers: [] });
				}
			},
			fireRiskOverlay: null,
			setFireRiskOverlay: (layer) => set({ fireRiskOverlay: layer }),
		}),
		{
			name: "map-store",
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({
				zoom: state.zoom,
				selectedBaseLayerId: state.selectedBaseLayerId,
			}),
		}
	)
);

/**
 * Update map position from saved user preference
 * Call this when map is initialized and user's saved location is loaded
 */
export const updateMapToSavedLocation = (customLocation?: { latitude: number; longitude: number; zoom?: number }) => {
	const mapLocation = customLocation || useMapLocationStore.getState().location;
	const mapStore = useMapStore.getState();

	const lonLat: [number, number] = [mapLocation.longitude, mapLocation.latitude];
	mapStore.setPosition(lonLat);

	if (mapLocation.zoom) {
		mapStore.setZoom(mapLocation.zoom);
	}

	if (mapStore.map) {
		const view = mapStore.map.getView();
		view.setCenter(fromLonLat(lonLat));
		if (mapLocation.zoom) {
			view.setZoom(mapLocation.zoom);
		}
	}
};
