import React, { ReactNode, useEffect, useState } from 'react';
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useMapProvider } from "@/providers/map-context";
import { initializeMap } from '@/features/interactive-map/utils/mapUtils';
import { CopyrightFooter } from "@/components/app-layout/CopyrightFooter";
import type { MapControlsPlacement } from "@/components/map-controls/MapControls";
import { BaseLayerSwitcher } from "@/components/map-controls/BaseLayerSwitcher";

interface MapContainerProps {
	topBar: ReactNode;
	sidebar?: ReactNode;
	showSidebar?: boolean;
	mapOverlays?: ReactNode;
	mapHeader?: ReactNode;
	className?: string;
	mapContainerClassName?: string;
    modal?: boolean;
    headerOffsetPx?: number;
	onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
	sidebarWidth?: string;
	controlsPlacement?: MapControlsPlacement;
	/** Further map buttons in the zoom and centre column. */
	controlsExtra?: ReactNode;
}

export const MapContainer: React.FC<MapContainerProps> = ({
	topBar,
	sidebar,
	showSidebar = true,
	mapOverlays,
	mapHeader,
	className = "",
	mapContainerClassName = "",
	modal = true,
	headerOffsetPx = 56,
	onDrop,
	onDragOver,
	sidebarWidth = "20rem",
	controlsPlacement,
	controlsExtra,
}) => {
	const { mapRef, initMapInstance, MapControls } = useMapProvider();
	const { map } = useMapStore();
	const [muted, setMuted] = useState<boolean>(false);

	// Initialize map using shared utility
	useEffect(() => {
		initializeMap(mapRef, initMapInstance, setMuted);
	}, [initMapInstance, mapRef]);

	return (
		<div className={`${modal ? 'fixed inset-0 bg-black bg-opacity-50 z-40' : 'relative w-full h-full'} ${className}`}>
			<div
				className="w-full h-full bg-gray-50 flex flex-col relative"
				style={{
					...(modal ? { paddingTop: `${headerOffsetPx}px` } : {}),
					// Expose sidebar width as a CSS variable so overlays (MapControls) can offset
					// @ts-expect-error: CSS custom property for sidebar offset
					['--sidebar-offset']: showSidebar ? sidebarWidth : '0rem',
				}}
			>
				<div className="flex-shrink-0" style={{ paddingRight: "var(--sidebar-offset)" }}>
					{topBar}
				</div>

				{mapHeader && (
					<div className="flex-shrink-0" style={{ paddingRight: "var(--sidebar-offset)" }}>
						{mapHeader}
					</div>
				)}

				<div className="relative flex-1 flex overflow-hidden">
					<div className="relative flex-1">
						<div className={`h-full bg-background overflow-hidden flex flex-col shadow-sm ${mapContainerClassName}`}>
							<div className="flex-1 min-h-0 relative">
								<div
									ref={mapRef}
									role="application"
									aria-label="Interactive map"
									className="w-full h-full"
									onDrop={onDrop}
									onDragOver={onDragOver}
								/>

								{map && !muted && <MapControls placement={controlsPlacement}>{controlsExtra}</MapControls>}
								{map && !muted && <BaseLayerSwitcher />}

								{mapOverlays}

								{/* Attribution lives with the map, cleared of any sidebar overlay. */}
								<CopyrightFooter
									style={{ right: "calc(1rem + var(--sidebar-offset, 0rem))" }}
								/>
							</div>
						</div>
					</div>
				</div>

				{showSidebar && (
					<div
						className="absolute right-0 z-40 bg-white border-l border-gray-200"
						style={{ width: sidebarWidth, ...(modal ? { top: `${headerOffsetPx}px`, height: `calc(100% - ${headerOffsetPx}px)` } : { top: 0, height: '100%' }) }}
					>
						{sidebar}
					</div>
				)}
			</div>
		</div>
	);
};

