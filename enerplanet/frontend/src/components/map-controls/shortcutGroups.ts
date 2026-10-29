/** One gesture in the Shortcuts menu: optional key, optional "+", and what it does. */
type ShortcutRow = { keys?: string; plus?: boolean; action: string };

/** Shortcut groups by what a gesture does: green draws, red deletes, blue moves the view. */
export const buildShortcutGroups = (
	t: (key: string, fallback: string) => string,
	isMapLibre3D: boolean,
): { key: string; title: string; titleClass: string; barClass: string; rows: ShortcutRow[] }[] => {
	return [
		{
			key: 'drawing',
			title: t('polygon.groupDrawing', 'Drawing'),
			titleClass: 'text-emerald-600 dark:text-emerald-400',
			barClass: 'border-emerald-500',
			rows: [
				{ action: t('polygon.moveVertex', 'Drag a corner to move it') },
				{ action: t('polygon.addVertex', 'Drag an edge to add a corner') },
				{ keys: t('polygon.keyRightClick', 'Right-click'), action: t('polygon.rightClickCloseHint', 'to close the polygon') },
				{ keys: 'Esc', action: t('polygon.escToCancel', 'to cancel drawing') },
			],
		},
		{
			key: 'deleting',
			title: t('polygon.groupDeleting', 'Deleting'),
			titleClass: 'text-red-600 dark:text-red-400',
			barClass: 'border-red-500',
			rows: [
				{ keys: 'Alt', plus: true, action: t('polygon.removeVertexHint', 'click on a corner to delete it') },
				{ keys: 'Shift', plus: true, action: t('polygon.removePolygonHint', 'click on polygon to delete it') },
			],
		},
		// Building gestures are handled on the 2D map only.
		...(isMapLibre3D ? [] : [{
			key: 'buildings',
			title: t('polygon.groupBuildings', 'Buildings'),
			titleClass: 'text-amber-600 dark:text-amber-400',
			barClass: 'border-amber-500',
			rows: [
				{ keys: 'Alt', plus: true, action: t('polygon.disableBuildingHint', 'click a building to disable or enable it') },
				{ keys: t('polygon.keyCtrl', 'Ctrl'), plus: true, action: t('polygon.selectBuildingHint', 'click buildings to select them') },
				{ keys: t('polygon.keyDelete', 'Delete'), action: t('polygon.disableSelectedHint', 'disables the selected buildings') },
			],
		}]),
		{
			key: 'navigating',
			title: t('polygon.groupNavigating', 'Navigating'),
			titleClass: 'text-blue-600 dark:text-blue-400',
			barClass: 'border-blue-500',
			rows: [
				{ keys: t('polygon.keySpace', 'Space'), plus: true, action: t('polygon.spacePanHint', 'drag to pan the map') },
				...(isMapLibre3D ? [{ keys: t('polygon.keyRightClick', 'Right-click'), plus: true, action: t('polygon.rotate3dDrag', 'drag to rotate the 3D view') }] : []),
			],
		},
	];
};
