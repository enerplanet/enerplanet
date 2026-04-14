import { useEffect, useState, useCallback } from "react";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useMapProvider } from "@/providers/map-context";
import { useAuth } from "@/providers/auth-provider";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { initializeMap } from '@/features/interactive-map/utils/mapUtils';
import { cn } from "@/lib/utils";
import { PrivacyConsentDialog, PrivacyBanner } from "@/features/privacy-controls";
import { CopyrightFooter } from "@/components/app-layout/CopyrightFooter";
import { MapControls } from "@/components/map-controls/MapControls";
import { BookmarkMenu } from "@/features/interactive-map/components/BookmarkMenu";
import MapSearchBar from "./MapSearchBar";
import axios from "@/lib/axios";
import { useNavigate } from "react-router-dom";
import { Plus, Map as MapIcon, Layers } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { MapLibre3DOverlay } from "@/components/map-controls/maplibre";
import { toLonLat, fromLonLat } from "ol/proj";
import { useMapPageLayers } from "./useMapPageLayers";
import { useMapPageOLLayers } from "./useMapPageOLLayers";

const PRIVACY_ACCEPTED_EVENT = "privacy-accepted";

export const MapComponent: React.FC = () => {
	useDocumentTitle('Interactive Map', ' | EnerPlanET');
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { mapRef, initMapInstance, clearDrawingLayers, zoomIn, zoomOut, centerMap } = useMapProvider();
	const { isLoading: authLoading, user } = useAuth();
	const [muted, setMuted] = useState<boolean>(false);
	const [showPrivacyDialog, setShowPrivacyDialog] = useState<boolean>(false);
	const [mapAccepted, setMapAccepted] = useState<boolean>(false);
	const [isCheckingPrivacy, setIsCheckingPrivacy] = useState<boolean>(true); // Add loading state
	const { map } = useMapStore();
	const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');

	// Fetch region boundaries (public) + user model polygons (private)
	const mapPageLayers = useMapPageLayers(!!user);

	const handleModelClick = useCallback((modelId: number, status?: string) => {
		if (status === 'completed' || status === 'published') {
			navigate(`/app/model-results/${modelId}`);
		} else {
			navigate(`/app/model-dashboard/edit/${modelId}`);
		}
	}, [navigate]);

	// OL layers for non-MapLibre base layers (boundaries + user models)
	useMapPageOLLayers({
		map,
		isMapLibre3D,
		availableBoundaryGeoJSON: mapPageLayers.availableBoundaryGeoJSON,
		userModelGeoJSON: mapPageLayers.userModelGeoJSON,
		onModelClick: handleModelClick,
	});

	const getCurrentView = useCallback(() => {
		if (!map) return { latitude: 48.83, longitude: 12.96, zoom: 12 };
		const view = map.getView();
		const center = view.getCenter();
		if (!center) return { latitude: 48.83, longitude: 12.96, zoom: 12 };
		const [lon, lat] = toLonLat(center);
		return { latitude: lat, longitude: lon, zoom: view.getZoom() ?? 12 };
	}, [map]);

	const flyTo = useCallback((latitude: number, longitude: number, zoom: number) => {
		if (!map) return;
		const view = map.getView();
		view.animate({
			center: fromLonLat([longitude, latitude]),
			zoom,
			duration: 800,
		});
	}, [map]);

	useEffect(() => {
		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		
		return () => {
			document.body.style.overflow = '';
			document.documentElement.style.overflow = '';
		};
	}, []);

	useEffect(() => {
		// Hybrid approach: Check localStorage first, then verify with database for logged-in users
		const checkPrivacy = async () => {
			setIsCheckingPrivacy(true);
			
			// First, check localStorage for immediate feedback (works for both logged-in and non-logged-in users)
			const localPrivacy = localStorage.getItem('privacy_accepted');
			
			if (!user) {
				// For non-logged-in users, rely solely on localStorage
				const accepted = localPrivacy === 'true';
				setMapAccepted(accepted);
				setIsCheckingPrivacy(false);
				return;
			}

			// For logged-in users: use localStorage for instant UI, then sync with database
			if (localPrivacy === 'true') {
				setMapAccepted(true);
				setIsCheckingPrivacy(false);
				
				// Verify with backend in background (sync database state to localStorage)
				axios.get('/settings').then(({ data }) => {
					if (data.success && data.data) {
						const dbAccepted = data.data.privacy_accepted;
						setMapAccepted(dbAccepted);
						localStorage.setItem('privacy_accepted', String(dbAccepted));
					}
				}).catch(() => {
					// Ignore errors, keep cached value
				});
				return;
			}

			// No localStorage cache, check database
			try {
				const { data } = await axios.get('/settings');
				if (data?.success && data?.data?.privacy_accepted) {
					setMapAccepted(true);
					localStorage.setItem('privacy_accepted', 'true');
				} else {
					setMapAccepted(false);
					localStorage.setItem('privacy_accepted', 'false');
				}
			} catch {
				// Error means settings not created yet or API issue
				setMapAccepted(false);
				localStorage.setItem('privacy_accepted', 'false');
			} finally {
				setIsCheckingPrivacy(false);
			}
		};

		checkPrivacy();
	}, [user]); // Re-check when user changes

	const handleAcceptPrivacy = async () => {
		// Update state immediately for instant UI feedback
		setMapAccepted(true);
		setShowPrivacyDialog(false);
		
		// Update localStorage (hybrid approach - persists across logout)
		localStorage.setItem('privacy_accepted', 'true');
		
		// Save to database for logged-in users
		if (user) {
			try {
				await axios.put('/settings/privacy-accepted', { accepted: true });
				// Wait for database update before triggering onboarding check
				setTimeout(() => {
					globalThis.dispatchEvent(new CustomEvent(PRIVACY_ACCEPTED_EVENT));
				}, 500);
			} catch {
				// Still dispatch event even if save fails
				globalThis.dispatchEvent(new CustomEvent(PRIVACY_ACCEPTED_EVENT));
			}
		} else {
			// For non-logged-in users, dispatch immediately
			globalThis.dispatchEvent(new CustomEvent(PRIVACY_ACCEPTED_EVENT));
		}
	};

	const handleDenyPrivacy = async () => {
		// Save denial to database for logged-in users
		if (user) {
			try {
				await axios.put('/settings/privacy-accepted', { accepted: false });
			} catch {
				// ignore
			}
		}
		
		setShowPrivacyDialog(false);
		setMapAccepted(false);
		
		// Update localStorage (hybrid approach)
		localStorage.setItem('privacy_accepted', 'false');
	};

	const handleOpenPrivacyDialog = () => {
		setShowPrivacyDialog(true);
	};

	const handleClosePrivacyDialog = () => {
		setShowPrivacyDialog(false);
	};

	useEffect(() => {
		// Only initialize map if privacy has been accepted and check is complete
		if (map || authLoading || isCheckingPrivacy || !mapAccepted) return;
		initializeMap(mapRef, initMapInstance, setMuted);
	}, [map, mapRef, initMapInstance, authLoading, mapAccepted, isCheckingPrivacy]);

	useEffect(() => {
		// Only attach map to container if privacy has been accepted
		if (!authLoading && map && mapRef.current && mapAccepted) {
			const timer = setTimeout(() => {
				const container = mapRef.current;
				if (container && map.getTarget() !== container) {
					map.setTarget(container);
				}
				map.updateSize();
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [authLoading, map, mapRef, mapAccepted]);

	useEffect(() => {
		if (muted && map) {
			clearDrawingLayers();
		}
	}, [muted, map, clearDrawingLayers]);

	// Cleanup: detach map from container on component unmount
	useEffect(() => {
		const currentMap = map;
		return () => {
			if (currentMap) {
				currentMap.setTarget();
			}
		};
	}, [map]);

	// Determine what content to show
	const renderMapContent = () => {
		if (isCheckingPrivacy) {
			return (
				<div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900">
					<div className="text-center px-4">
						<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 dark:border-gray-400 mx-auto mb-4"></div>
						<p className="text-gray-600 dark:text-gray-400 text-sm">
							Loading map...
						</p>
					</div>
				</div>
			);
		}

		if (mapAccepted) {
			return (
				<>
					<div ref={mapRef} className={cn("w-full h-full")} data-tour="map" />
					{map && isMapLibre3D && (
						<MapLibre3DOverlay
							olMap={map}
							visible={isMapLibre3D}
							availableBoundaryGeoJSON={mapPageLayers.availableBoundaryGeoJSON}
							userModelGeoJSON={mapPageLayers.userModelGeoJSON}
							onUserModelClick={handleModelClick}
						/>
					)}

					{map && <MapSearchBar />}

					<MapControls onZoomIn={zoomIn} onZoomOut={zoomOut} onCenterMap={centerMap} />

					{/* Map info panel — regions + user models (visible on all base layers) */}
					{map && (mapPageLayers.regionCount > 0 || mapPageLayers.modelCount > 0) && (
						<div className="absolute bottom-[4.5rem] left-4 z-30 bg-card/95 backdrop-blur-md border border-border/60 rounded-xl shadow-lg px-1 py-1 flex items-center gap-0.5 text-xs">
							{mapPageLayers.regionCount > 0 && (
								<div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/8 dark:bg-indigo-400/10">
									<div className="w-5 h-5 rounded-md bg-indigo-500/15 flex items-center justify-center">
										<MapIcon className="w-3 h-3 text-indigo-500" />
									</div>
									<div className="flex flex-col leading-none">
										<span className="text-[11px] font-semibold text-foreground">{mapPageLayers.regionCount}</span>
										<span className="text-[9px] text-muted-foreground">{t('map.regions', 'regions')}</span>
									</div>
								</div>
							)}
							{mapPageLayers.modelCount > 0 && (
								<div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/8 dark:bg-emerald-400/10">
									<div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center">
										<Layers className="w-3 h-3 text-emerald-500" />
									</div>
									<div className="flex flex-col leading-none">
										<span className="text-[11px] font-semibold text-foreground">{mapPageLayers.modelCount}</span>
										<span className="text-[9px] text-muted-foreground">{t('map.myModels', 'my models')}</span>
									</div>
								</div>
							)}
						</div>
					)}

					{map && (
						<div className="absolute top-4 right-4 z-30">
							<BookmarkMenu getCurrentView={getCurrentView} flyTo={flyTo} />
						</div>
					)}

					{user && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									onClick={() => navigate("/app/model-dashboard/new-model")}
									className="absolute bottom-20 right-6 w-14 h-14 rounded-2xl shadow-xl transition-all duration-200 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 z-30"
								>
									<Plus className="w-6 h-6" />
								</button>
							</TooltipTrigger>
							<TooltipContent side="left">
								{t("model.newModel")}
							</TooltipContent>
						</Tooltip>
					)}
				</>
			);
		}

		return (
			<div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900">
				<div className="text-center px-4">
					<p className="text-gray-600 dark:text-gray-400 text-lg mb-4">
						Please accept the Data & Privacy terms to view the map
					</p>
					<button
						onClick={handleOpenPrivacyDialog}
						className="px-6 py-2.5 text-sm font-medium text-white bg-gray-600 hover:bg-gray-500 rounded-md transition-colors"
					>
						Review Privacy Terms
					</button>
				</div>
			</div>
		);
	};

	return (
		<div className={cn("w-full h-full", "relative overflow-hidden")}>
			{renderMapContent()}

			<PrivacyBanner
				onClick={handleOpenPrivacyDialog}
				hasAccepted={mapAccepted}
			/>

			<CopyrightFooter />

			<PrivacyConsentDialog
				isOpen={showPrivacyDialog}
				onAccept={handleAcceptPrivacy}
				onDeny={handleDenyPrivacy}
				onClose={handleClosePrivacyDialog}
			/>
		</div>
	);
};
