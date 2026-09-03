// ---------------------------------------------------------------------------
// Heat-link mode — producer → consumer wiring (plan §2).
//
// Two-step map interaction on top of the unified `activeMode`:
//   1. Click a PRODUCER building (one whose assigned techs resolve heat, i.e.
//      hasHeatTech) → it becomes `selectedHeatLinkSource`.
//   2. Click a CONSUMER building (usually without its own heat tech) → the
//      link is written as `heat_supplier = <producer osm_id>` on the consumer's
//      feature props, so heat resolution downstream treats it as supplied.
//
// Writes the identical property (`heat_supplier`) that `useHeatResolution` /
// the payload builder read, replacing the harness's `supplierId` select with a
// map-native flow. Escape (or re-toggle) exits the mode and clears the pending
// source; consumers keep any links already drawn.
// ---------------------------------------------------------------------------

import type { Feature, Map as OLMap } from "ol";
import type { Geometry } from "ol/geom";
import { Fill, Stroke, Style } from "ol/style";
import { useCallback, useEffect, useRef } from "react";

import { useModelStore } from "@/features/configurator/store/modelStore";
import { hasHeatTech } from "@/features/configurator/utils/heatResolution";

interface HeatLinkModeOptions {
	map: OLMap | null;
	notification: {
		showSuccess: (message: string) => void;
		showError: (message: string) => void;
	};
	setIsModified: (v: boolean) => void;
}

export interface HeatLinkModeState {
	isHeatLinkMode: boolean;
	selectedHeatLinkSource: string | null;
	setHeatLinkMode: (active: boolean) => void;
	toggleHeatLinkMode: () => void;
	/** Drop the pending producer but stay in mode (re-pick from scratch). */
	clearHeatLinkSource: () => void;
	clearHeatLinkMode: () => void;
}

const PRODUCER_HIGHLIGHT = new Style({
	fill: new Fill({ color: "rgba(217, 119, 6, 0.35)" }), // amber — heat producer
	stroke: new Stroke({ color: "#d97706", width: 3 }),
});

const readOsmId = (feature: Feature<Geometry>): string | null => {
	const raw = feature.get("osm_id");
	if (raw === undefined || raw === null) return null;
	const osmId = String(raw).trim();
	return osmId ? osmId : null;
};

export const useHeatLinkMode = ({
	map,
	notification,
	setIsModified,
}: HeatLinkModeOptions): HeatLinkModeState => {
	const activeMode = useModelStore((s) => s.activeMode);
	const setActiveMode = useModelStore((s) => s.setActiveMode);
	const selectedHeatLinkSource = useModelStore((s) => s.selectedHeatLinkSource);
	const setSelectedHeatLinkSource = useModelStore(
		(s) => s.setSelectedHeatLinkSource,
	);

	const isHeatLinkMode = activeMode === "heat-link";

	// Keep the producer feature so we can drop its highlight when the source is
	// re-picked or the mode exits (mirrors useBuildingAssignMode).
	const sourceFeatureRef = useRef<Feature<Geometry> | null>(null);

	const clearHeatLinkSource = useCallback(() => {
		sourceFeatureRef.current?.setStyle(undefined);
		sourceFeatureRef.current = null;
		setSelectedHeatLinkSource(null);
	}, [setSelectedHeatLinkSource]);

	const setHeatLinkMode = useCallback(
		(active: boolean) => {
			if (active) {
				setActiveMode("heat-link");
			} else {
				clearHeatLinkSource();
				setActiveMode(null);
			}
		},
		[setActiveMode, clearHeatLinkSource],
	);

	const toggleHeatLinkMode = useCallback(() => {
		setHeatLinkMode(!(activeMode === "heat-link"));
	}, [activeMode, setHeatLinkMode]);

	const clearHeatLinkMode = useCallback(() => {
		setHeatLinkMode(false);
	}, [setHeatLinkMode]);

	// Map click handler for the two-step link flow.
	useEffect(() => {
		if (!map || !isHeatLinkMode) return;

		const handleMapClick = (evt: { pixel: number[] }) => {
			const feature: Feature<Geometry> | undefined = map.forEachFeatureAtPixel(
				evt.pixel,
				(f) =>
					f.get("feature_type") === "building"
						? (f as Feature<Geometry>)
						: undefined,
			);
			if (!feature) return;

			const osmId = readOsmId(feature);
			if (!osmId) return;

			// Step 2 — a producer is pending: this click is the consumer.
			if (selectedHeatLinkSource) {
				if (osmId === selectedHeatLinkSource) {
					notification.showError(
						"A building cannot supply itself — pick a different consumer.",
					);
					return;
				}
				feature.set("heat_supplier", selectedHeatLinkSource);
				sourceFeatureRef.current?.setStyle(undefined);
				sourceFeatureRef.current = null;
				setSelectedHeatLinkSource(null);
				setIsModified(true);
				notification.showSuccess(`Heat link drawn to ${osmId}.`);
				return;
			}

			// Step 1 — no producer yet: this click picks the producer (must produce heat).
			if (!hasHeatTech(feature.get("techs"))) {
				notification.showError(
					"Selected building has no heat-producing tech — pick a producer first.",
				);
				return;
			}
			sourceFeatureRef.current?.setStyle(undefined);
			sourceFeatureRef.current = feature;
			feature.setStyle(PRODUCER_HIGHLIGHT);
			setSelectedHeatLinkSource(osmId);
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				clearHeatLinkMode();
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		const mapElement = map.getTargetElement();
		if (mapElement) {
			mapElement.style.cursor = selectedHeatLinkSource
				? "crosshair"
				: "pointer";
		}

		map.on("click", handleMapClick);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			map.un("click", handleMapClick);
			if (mapElement) {
				mapElement.style.cursor = "";
			}
		};
	}, [
		map,
		isHeatLinkMode,
		selectedHeatLinkSource,
		setSelectedHeatLinkSource,
		clearHeatLinkMode,
		setIsModified,
		notification.showSuccess,
		notification.showError,
	]);

	// Clean up the pending source & highlight when the mode is exited externally.
	useEffect(() => {
		if (!isHeatLinkMode) {
			clearHeatLinkSource();
		}
	}, [isHeatLinkMode, clearHeatLinkSource]);

	return {
		isHeatLinkMode,
		selectedHeatLinkSource,
		setHeatLinkMode,
		toggleHeatLinkMode,
		clearHeatLinkSource,
		clearHeatLinkMode,
	};
};
