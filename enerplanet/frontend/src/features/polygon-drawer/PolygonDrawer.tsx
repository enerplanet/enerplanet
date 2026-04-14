import { useEffect, useRef, useState, type FC } from 'react';
import Draw, { type DrawEvent } from 'ol/interaction/Draw';
import Modify, { type ModifyEvent } from 'ol/interaction/Modify';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { toLonLat, fromLonLat } from 'ol/proj';
import type { Coordinate } from 'ol/coordinate';
import type Polygon from 'ol/geom/Polygon';
import type Map from 'ol/Map';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { Feature } from 'ol';
import { Polygon as OLPolygon, Point } from 'ol/geom';
import { platformModifierKeyOnly } from 'ol/events/condition';
import buffer from '@turf/buffer';
import type { Feature as GeoJSONFeature, Polygon as GeoJSONPolygon, Position } from 'geojson';

interface PolygonDrawerProps {
    map: Map | null;
    onPolygonDrawn?: (coordinates: [number, number][], allPolygons: [number, number][][]) => void;
    onPolygonModified?: (allPolygons: [number, number][][]) => void;
    onDrawingChange?: (isDrawing: boolean) => void;
    onPointCountChange?: (count: number) => void;
    onClearAll?: () => void;
    allowMultiple?: boolean;
    clearTrigger?: number;
    initialPolygons?: [number, number][][];
    bufferDistanceMeters?: number;
    /** If true, disables drawing after first polygon is created (unless cleared) */
    disableAfterDraw?: boolean;
    /** If true, only displays polygons without allowing editing */
    readOnly?: boolean;
    /** If true, enables polygon vertex editing (drag vertices, add/remove points) */
    enableEditing?: boolean;
    /** Translation labels */
    labels?: {
        clickToClose?: string;
        start?: string;
    };
}

export const PolygonDrawer: FC<PolygonDrawerProps> = ({
    map,
    onPolygonDrawn,
    onPolygonModified,
    onDrawingChange,
    onPointCountChange,
    onClearAll,
    allowMultiple = false,
    clearTrigger = 0,
    initialPolygons,
    bufferDistanceMeters = 0,
    disableAfterDraw = false,
    readOnly = false,
    enableEditing = true,
    labels = {},
}) => {
    const onPolygonDrawnRef = useRef(onPolygonDrawn);
    const onPolygonModifiedRef = useRef(onPolygonModified);
    const onDrawingChangeRef = useRef(onDrawingChange);
    const onPointCountChangeRef = useRef(onPointCountChange);
    const onClearAllRef = useRef(onClearAll);
    const vectorSourceRef = useRef<VectorSource | null>(null);
    const bufferSourceRef = useRef<VectorSource | null>(null);
    const startPointSourceRef = useRef<VectorSource | null>(null);
    const allPolygonsRef = useRef<[number, number][][]>([]);
    const bufferDistanceRef = useRef<number>(bufferDistanceMeters);
    const drawInteractionRef = useRef<Draw | null>(null);
    const modifyInteractionRef = useRef<Modify | null>(null);
    const modifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [sourceReady, setSourceReady] = useState(false);

    useEffect(() => {
        bufferDistanceRef.current = bufferDistanceMeters;
    }, [bufferDistanceMeters]);

    useEffect(() => {
        onPolygonDrawnRef.current = onPolygonDrawn;
        onPolygonModifiedRef.current = onPolygonModified;
        onDrawingChangeRef.current = onDrawingChange;
        onPointCountChangeRef.current = onPointCountChange;
        onClearAllRef.current = onClearAll;
    }, [onPolygonDrawn, onPolygonModified, onDrawingChange, onPointCountChange, onClearAll]);

    useEffect(() => {
        if (clearTrigger > 0 && vectorSourceRef.current) {
            vectorSourceRef.current.clear();
            bufferSourceRef.current?.clear();
            startPointSourceRef.current?.clear();
            allPolygonsRef.current = [];
            // Re-enable draw interaction when cleared (check for duplicates)
            if (map && drawInteractionRef.current && disableAfterDraw && !allowMultiple) {
                const interactions = map.getInteractions().getArray();
                if (!interactions.includes(drawInteractionRef.current)) {
                    map.addInteraction(drawInteractionRef.current);
                }
            }
        }
    }, [clearTrigger, map, disableAfterDraw, allowMultiple]);

    useEffect(() => {
        if (initialPolygons && initialPolygons.length > 0 && vectorSourceRef.current && sourceReady && map) {
            // Clear existing features first
            vectorSourceRef.current.clear();
            allPolygonsRef.current = [];

            for (const polygonCoords of initialPolygons) {
                const mapCoords = polygonCoords.map(([lon, lat]) => fromLonLat([lon, lat]));
                mapCoords.push(mapCoords[0]);

                const polygon = new OLPolygon([mapCoords]);
                const feature = new Feature({ geometry: polygon });

                vectorSourceRef.current?.addFeature(feature);
                allPolygonsRef.current.push(polygonCoords);
            }
            if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
                recomputeBuffers(bufferDistanceRef.current);
            }

            // Zoom to fit all polygons with a small delay to ensure map is ready
            const fitToExtent = () => {
                if (!vectorSourceRef.current) return;
                const extent = vectorSourceRef.current.getExtent();
                if (extent && extent[0] !== Infinity) {
                    map.getView().fit(extent, {
                        padding: [50, 50, 50, 50],
                        duration: 1500,
                        maxZoom: 18
                    });
                }
            };

            // Fit immediately and also after a short delay to handle refresh scenarios
            fitToExtent();
            const timer = setTimeout(fitToExtent, 300);

            // Disable drawing when initial polygons are loaded (edit mode)
            // Drawing will be re-enabled when user clears all polygons
            if (disableAfterDraw && !allowMultiple && drawInteractionRef.current) {
                map.removeInteraction(drawInteractionRef.current);
            }

            return () => clearTimeout(timer);
        }
    }, [initialPolygons, sourceReady, map, disableAfterDraw, allowMultiple]);

    useEffect(() => {
        if (!map) {
            return;
        }

        const vectorSource = new VectorSource({ wrapX: false });
        vectorSourceRef.current = vectorSource;
        setSourceReady(true);

        const vectorLayer = new VectorLayer({
            source: vectorSource,
            style: new Style({
                fill: new Fill({
                    color: 'transparent',
                }),
                stroke: new Stroke({
                    color: '#000000',
                    width: 2.5,
                }),
            }),
            zIndex: 2000, // High z-index to ensure polygon stays on top of all grid layers
        });

        map.addLayer(vectorLayer);

        const bufferSource = new VectorSource({ wrapX: false });
        bufferSourceRef.current = bufferSource;
        const bufferLayer = new VectorLayer({
            source: bufferSource,
            style: new Style({
                fill: new Fill({ color: 'rgba(251, 191, 36, 0.3)' }),
                stroke: new Stroke({ color: '#f59e0b', width: 3, lineDash: [8, 4] }),
            }),
            zIndex: 2001, // Above polygon layer
        });
        map.addLayer(bufferLayer);

        // Starting point indicator layer
        const startPointSource = new VectorSource({ wrapX: false });
        startPointSourceRef.current = startPointSource;
        const startPointLayer = new VectorLayer({
            source: startPointSource,
            style: (feature) => {
                const isNearStart = feature.get('isNearStart');
                return new Style({
                    image: new CircleStyle({
                        radius: isNearStart ? 12 : 8,
                        fill: new Fill({ color: isNearStart ? '#06b6d4' : '#06b6d4' }), // cyan-500
                        stroke: new Stroke({ 
                            color: isNearStart ? '#0891b2' : '#0e7490', // cyan-600/700
                            width: isNearStart ? 3 : 2,
                        }),
                    }),
                    text: new Text({
                        text: isNearStart ? (labels.clickToClose ?? 'Click to close') : (labels.start ?? 'Start'),
                        offsetY: isNearStart ? -22 : -18,
                        font: isNearStart ? 'bold 12px Inter, system-ui, sans-serif' : '11px Inter, system-ui, sans-serif',
                        fill: new Fill({ color: '#0e7490' }), // cyan-700
                        stroke: new Stroke({ color: '#ffffff', width: 3 }),
                        padding: [2, 4, 2, 4],
                    }),
                });
            },
            zIndex: 2002, // Above buffer layer
        });
        map.addLayer(startPointLayer);

        // Snap distance in pixels for detecting proximity to start point
        const SNAP_DISTANCE = 20;
        const DRAW_SKETCH_Z_INDEX = 2003;
        const MODIFY_SKETCH_Z_INDEX = 2004;
        let startCoord: Coordinate | null = null;
        let isNearStartPoint = false;

        const sketchStyle = new Style({
            fill: new Fill({ color: 'rgba(0, 0, 0, 0.05)' }),
            stroke: new Stroke({ color: '#000000', width: 2, lineDash: [4, 4] }),
            image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#000000' }) }),
        });

        // Track keydown handler so cleanup can remove it
        let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;
        let handleContextMenu: ((e: MouseEvent) => void) | null = null;

        // Only add draw interaction if not in readOnly mode
        if (!readOnly) {
            const draw = new Draw({
                source: vectorSource,
                type: 'Polygon',
                style: sketchStyle,
            });
            drawInteractionRef.current = draw;

            map.addInteraction(draw);
            draw.getOverlay().setZIndex(DRAW_SKETCH_Z_INDEX);

            // Track the first point during drawing
            let isFirstPoint = true;

            draw.on('drawstart', (event: DrawEvent) => {
                if (!allowMultiple) {
                    vectorSource.clear();
                    bufferSourceRef.current?.clear();
                    startPointSourceRef.current?.clear();
                    allPolygonsRef.current = [];
                }

                isFirstPoint = true;
                startCoord = null;
                isNearStartPoint = false;

                // Listen to geometry changes to show starting point and track point count
                const sketch = event.feature;
                const geom = sketch.getGeometry() as Polygon;

                geom.on('change', () => {
                    const coords = geom.getCoordinates()[0];
                    // Report point count (subtract 1 because last point is cursor position)
                    const pointCount = Math.max(0, coords.length - 1);
                    if (onPointCountChangeRef.current) {
                        onPointCountChangeRef.current(pointCount);
                    }

                    if (coords.length > 0 && isFirstPoint) {
                        isFirstPoint = false;
                        startCoord = coords[0];
                        // Add starting point marker
                        const startPoint = new Feature({
                            geometry: new Point(coords[0]),
                        });
                        startPoint.set('isNearStart', false);
                        startPointSourceRef.current?.clear();
                        startPointSourceRef.current?.addFeature(startPoint);
                    }

                    // Check if cursor is near start point (need at least 3 points to close)
                    if (startCoord && coords.length > 3) {
                        const cursorCoord = coords[coords.length - 1];
                        const startPixel = map.getPixelFromCoordinate(startCoord);
                        const cursorPixel = map.getPixelFromCoordinate(cursorCoord);

                        if (startPixel && cursorPixel) {
                            const distance = Math.sqrt(
                                Math.pow(startPixel[0] - cursorPixel[0], 2) +
                                Math.pow(startPixel[1] - cursorPixel[1], 2)
                            );

                            const wasNear = isNearStartPoint;
                            isNearStartPoint = distance < SNAP_DISTANCE;

                            // Update start point feature style when near state changes
                            if (wasNear !== isNearStartPoint) {
                                const features = startPointSourceRef.current?.getFeatures();
                                if (features && features.length > 0) {
                                    features[0].set('isNearStart', isNearStartPoint);
                                }

                                // Change cursor style
                                const viewport = map.getViewport();
                                if (isNearStartPoint) {
                                    viewport.style.cursor = 'pointer';
                                } else {
                                    viewport.style.cursor = 'crosshair';
                                }
                            }
                        }
                    }
                });

                // Set crosshair cursor when drawing starts
                map.getViewport().style.cursor = 'crosshair';

                if (onDrawingChangeRef.current) {
                    onDrawingChangeRef.current(true);
                }
            });

            draw.on('drawend', (event: DrawEvent) => {
                // Clear the starting point marker when drawing completes
                startPointSourceRef.current?.clear();
                startCoord = null;
                isNearStartPoint = false;

                // Reset cursor
                map.getViewport().style.cursor = '';

                // Reset point count
                if (onPointCountChangeRef.current) {
                    onPointCountChangeRef.current(0);
                }

                const polygon = event.feature.getGeometry() as Polygon;
                const coords = polygon.getCoordinates()[0];

                let lonLatCoords = coords.map((coord: Coordinate) => {
                    const [lon, lat] = toLonLat(coord);
                    return [lon, lat] as [number, number];
                });

                if (
                    lonLatCoords.length > 2 &&
                    lonLatCoords[0][0] === lonLatCoords.at(-1)?.[0] &&
                    lonLatCoords[0][1] === lonLatCoords.at(-1)?.[1]
                ) {
                    lonLatCoords = lonLatCoords.slice(0, -1);
                }

                allPolygonsRef.current.push(lonLatCoords);

                if (onPolygonDrawnRef.current) {
                    onPolygonDrawnRef.current(lonLatCoords, [...allPolygonsRef.current]);
                }

                if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
                    recomputeBuffers(bufferDistanceRef.current);
                }

                if (onDrawingChangeRef.current) {
                    onDrawingChangeRef.current(false);
                }

                // Disable drawing after first polygon if disableAfterDraw is true
                if (disableAfterDraw && !allowMultiple) {
                    map.removeInteraction(draw);
                }
            });

            // Add Modify interaction for editing polygon vertices if enabled
            if (enableEditing) {
                const modify = new Modify({
                    source: vectorSource,
                    // Alt+click to delete vertices
                    deleteCondition: (event) => {
                        return platformModifierKeyOnly(event) && event.type === 'singleclick';
                    },
                    // Style for vertices during editing
                    style: new Style({
                        image: new CircleStyle({
                            radius: 6,
                            fill: new Fill({ color: '#06b6d4' }), // cyan-500
                            stroke: new Stroke({ color: '#0891b2', width: 2 }), // cyan-600
                        }),
                    }),
                });
                modifyInteractionRef.current = modify;
                map.addInteraction(modify);
                modify.getOverlay().setZIndex(MODIFY_SKETCH_Z_INDEX);

                // Handle modification end - sync allPolygonsRef and notify parent
                modify.on('modifyend', (_event: ModifyEvent) => {
                    // Rebuild allPolygonsRef from current features IMMEDIATELY for visual feedback
                    const features = vectorSource.getFeatures();
                    const updatedPolygons: [number, number][][] = [];

                    for (const feature of features) {
                        const geom = feature.getGeometry() as Polygon;
                        if (geom) {
                            const coords = geom.getCoordinates()[0];
                            let lonLatCoords = coords.map((coord: Coordinate) => {
                                const [lon, lat] = toLonLat(coord);
                                return [lon, lat] as [number, number];
                            });

                            // Remove duplicate closing point if present
                            if (
                                lonLatCoords.length > 2 &&
                                lonLatCoords[0][0] === lonLatCoords.at(-1)?.[0] &&
                                lonLatCoords[0][1] === lonLatCoords.at(-1)?.[1]
                            ) {
                                lonLatCoords = lonLatCoords.slice(0, -1);
                            }

                            updatedPolygons.push(lonLatCoords);
                        }
                    }

                    // Update local state immediately
                    allPolygonsRef.current = updatedPolygons;

                    // Recompute buffers immediately for visual feedback
                    if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
                        recomputeBuffers(bufferDistanceRef.current);
                    }

                    // Debounce only the API call (grid regeneration) to prevent rapid successive calls
                    if (modifyDebounceRef.current) {
                        clearTimeout(modifyDebounceRef.current);
                    }

                    modifyDebounceRef.current = setTimeout(() => {
                        if (onPolygonModifiedRef.current) {
                            onPolygonModifiedRef.current([...updatedPolygons]);
                        }
                    }, 300); // 300ms debounce for API call only
                });
            }

            // Right-click to finish and close polygon (need at least 3 vertices)
            let currentPointCount = 0;
            handleContextMenu = (e: MouseEvent) => {
                if (currentPointCount >= 3 && drawInteractionRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    drawInteractionRef.current.finishDrawing();
                }
            };

            // Track point count from geometry change events for the right-click handler
            draw.on('drawstart', (evt: DrawEvent) => {
                currentPointCount = 0;
                const geom = evt.feature.getGeometry() as Polygon;
                geom.on('change', () => {
                    const coords = geom.getCoordinates()[0];
                    currentPointCount = Math.max(0, coords.length - 1);
                });
            });
            draw.on('drawend', () => {
                currentPointCount = 0;
            });

            map.getViewport().addEventListener('contextmenu', handleContextMenu);

            // Handle Escape key to cancel drawing or clear completed polygons
            handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    // Abort any in-progress drawing
                    if (drawInteractionRef.current) {
                        drawInteractionRef.current.abortDrawing();
                    }

                    // Clear the start point marker and reset state
                    startPointSourceRef.current?.clear();
                    startCoord = null;
                    isNearStartPoint = false;

                    // Reset cursor
                    map.getViewport().style.cursor = '';

                    // Reset point count
                    if (onPointCountChangeRef.current) {
                        onPointCountChangeRef.current(0);
                    }

                    // Notify drawing stopped
                    if (onDrawingChangeRef.current) {
                        onDrawingChangeRef.current(false);
                    }

                    // Always clear polygon sources and layers
                    vectorSourceRef.current?.clear();
                    bufferSourceRef.current?.clear();

                    allPolygonsRef.current = [];

                    // Re-enable draw interaction if it was disabled
                    if (disableAfterDraw && !allowMultiple && drawInteractionRef.current) {
                        // Check if interaction is already added to avoid duplicates
                        const interactions = map.getInteractions().getArray();
                        if (!interactions.includes(drawInteractionRef.current)) {
                            map.addInteraction(drawInteractionRef.current);
                        }
                    }

                    // Always notify parent to clear polygons and buildings
                    // (parent will handle clearing buildings via processPylovoData)
                    if (onClearAllRef.current) {
                        onClearAllRef.current();
                    }
                }
            };

            document.addEventListener('keydown', handleKeyDown);
        }

        // Single cleanup function that handles all teardown
        return () => {
            if (handleKeyDown) {
                document.removeEventListener('keydown', handleKeyDown);
            }
            if (handleContextMenu) {
                map.getViewport().removeEventListener('contextmenu', handleContextMenu);
            }
            if (drawInteractionRef.current) {
                map.removeInteraction(drawInteractionRef.current);
            }
            if (modifyInteractionRef.current) {
                map.removeInteraction(modifyInteractionRef.current);
            }
            if (modifyDebounceRef.current) {
                clearTimeout(modifyDebounceRef.current);
            }
            map.removeLayer(vectorLayer);
            map.removeLayer(bufferLayer);
            map.removeLayer(startPointLayer);
            vectorSourceRef.current = null;
            bufferSourceRef.current = null;
            startPointSourceRef.current = null;
            drawInteractionRef.current = null;
            modifyInteractionRef.current = null;
            modifyDebounceRef.current = null;
            allPolygonsRef.current = [];
            setSourceReady(false);
        };
    }, [map, allowMultiple, disableAfterDraw, readOnly, enableEditing]);

    const recomputeBuffers = (distanceMeters: number) => {
        const source = bufferSourceRef.current;
        if (!source) {
            return;
        }
        source.clear();
        if (!distanceMeters || distanceMeters <= 0) {
            return;
        }

        try {
            for (const lonLatCoords of allPolygonsRef.current) {
                processPolygonBuffer(lonLatCoords, distanceMeters, source);
            }
        } catch (e) {
            if (import.meta.env.DEV) console.warn('Buffer computation failed', e);
        }
    };

    useEffect(() => {
        recomputeBuffers(bufferDistanceMeters);
    }, [bufferDistanceMeters]);

    return null;
};

const processPolygonBuffer = (lonLatCoords: number[][], distanceMeters: number, source: VectorSource) => {
    if (lonLatCoords.length < 3) return;

    const closed = [...lonLatCoords, lonLatCoords[0]];
    const feature: GeoJSONFeature<GeoJSONPolygon> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
    };

    const distanceKm = distanceMeters / 1000;
    const buffered = buffer(feature, distanceKm);

    if (!buffered?.geometry) {
        if (import.meta.env.DEV) console.warn('Buffer computation returned null or no geometry');
        return;
    }

    if (buffered.geometry.type === 'Polygon') {
        const rings = buffered.geometry.coordinates[0] as [number, number][];
        const mapCoords = rings.map(([lon, lat]: [number, number]) => fromLonLat([lon, lat]));
        const poly = new OLPolygon([mapCoords]);
        const bufferFeature = new Feature({ geometry: poly });
        source.addFeature(bufferFeature);
    } else if (buffered.geometry.type === 'MultiPolygon') {
        for (const polyCoords of buffered.geometry.coordinates) {
            const rings = polyCoords[0];
            const mapCoords = rings.map((pos: Position) => {
                const [lon, lat] = pos as [number, number];
                return fromLonLat([lon, lat]);
            });
            const poly = new OLPolygon([mapCoords]);
            const bufferFeature = new Feature({ geometry: poly });
            source.addFeature(bufferFeature);
        }
    }
};
