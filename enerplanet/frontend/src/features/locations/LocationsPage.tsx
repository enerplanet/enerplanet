import { useState, useEffect, useCallback, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslation } from '@spatialhub/i18n';
import {
  Plus,
  MapPin,
  Globe,
  Lock,
  Search,
  Trash2,
  Copy,
  Edit,
  Eye,
  RefreshCw,
  MapPinned,
  Share2
} from 'lucide-react';
import { useCustomLocationStore } from '@/features/locations/store/custom-location-store';
import type { CustomLocation } from '@/features/locations/services/customLocationService';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatsStrip } from '@/components/ui/StatsStrip';
import { ListSkeleton } from '@/components/ui/Skeletons';
import {
  CARD_CLASS,
  PAGE_SHELL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SEARCH_INPUT_CLASS,
  TOOLBAR_ICON_BUTTON_CLASS,
} from '@/components/ui/toolbar';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import Notification from '@/components/ui/Notification';
import { useConfirm } from '@/hooks/useConfirmDialog';
import ModelActionGroup from '@/components/shared/ModelActionGroup';
import { LocationShareDialog } from './LocationShareDialog';
import {
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@spatialhub/ui';

const formatArea = (area: number) =>
  area > 10000 ? `${(area / 1000000).toFixed(1)} km²` : `${(area / 1000).toFixed(1)} k m²`;

const LocationRow: FC<{
  location: CustomLocation;
  index: number;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onCopy: (id: number) => void;
  onShare: (location: CustomLocation) => void;
  onTogglePublic: (id: number, isPublic: boolean) => void;
  showPublicToggle?: boolean;
  isOwner?: boolean;
}> = ({ location, index, onView, onEdit, onDelete, onCopy, onShare, onTogglePublic, showPublicToggle = true, isOwner = true }) => {
  const { t } = useTranslation();
  return (
    <div
      className="md-row-in group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/40"
      style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
    >
      {/* Icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <MapPin className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground" title={location.title}>
          {location.title}
        </span>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
          {location.f_class}
        </span>
      </div>

      {/* Stats */}
      <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
        <span className="tabular-nums">{formatArea(location.area)}</span>
        <span aria-hidden="true">•</span>
        <span className="tabular-nums">{(location.demand_energy / 1000).toFixed(0)} MWh</span>
      </div>

      {/* Public/Private Switch */}
      {showPublicToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex shrink-0 origin-center scale-[0.65] items-center">
              <Switch
                checked={location.is_public}
                onCheckedChange={(checked) => onTogglePublic(location.id, checked)}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {location.is_public ? t('locations.toggle.makePrivate') : t('locations.toggle.makePublic')}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Action Icons */}
      <div className="flex items-center gap-1 transition-opacity duration-150 sm:opacity-80 sm:group-hover:opacity-100">
        <ModelActionGroup
          actions={[
            { key: 'view', icon: Eye, tooltip: t('common.tooltips.viewOnMap'), variant: 'info', onClick: () => onView(location.id) },
            { key: 'edit', icon: Edit, tooltip: t('common.tooltips.editLocation'), variant: 'default', onClick: () => onEdit(location.id), show: isOwner },
            { key: 'share', icon: Share2, tooltip: t('locations.share.title'), variant: 'purple', onClick: () => onShare(location), show: isOwner },
            { key: 'copy', icon: Copy, tooltip: t('common.tooltips.duplicate'), variant: 'default', onClick: () => onCopy(location.id) },
            { key: 'delete', icon: Trash2, tooltip: t('common.delete'), variant: 'danger', onClick: () => onDelete(location.id), show: isOwner },
          ]}
          size="small"
        />
      </div>
    </div>
  );
};

const LocationsPage: FC = () => {
  const { t } = useTranslation();
  useDocumentTitle(t('locations.title'), ' | EnerPlanET');
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notification, showSuccess, showError, hide: hideNotification } = useNotification();
  const {
    locations,
    publicLocations,
    isLoading,
    fetchUserLocations,
    fetchPublicLocations,
    refetchLocations,
    deleteLocation,
    copyLocation,
    togglePublic,
  } = useCustomLocationStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('my');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [selectedLocationForShare, setSelectedLocationForShare] = useState<CustomLocation | null>(null);

  useEffect(() => {
    fetchUserLocations();
    fetchPublicLocations();
  }, [fetchUserLocations, fetchPublicLocations]);

  const handleCreateNew = useCallback(() => {
    navigate('/app/locations/create');
  }, [navigate]);

  const handleView = useCallback((id: number) => {
    navigate(`/app/locations/view/${id}`);
  }, [navigate]);

  const handleEdit = useCallback((id: number) => {
    navigate(`/app/locations/edit/${id}`);
  }, [navigate]);

  const handleShare = useCallback((location: CustomLocation) => {
    setSelectedLocationForShare(location);
    setShareDialogOpen(true);
  }, []);

  const handleCloseShareDialog = useCallback(() => {
    setShareDialogOpen(false);
    setSelectedLocationForShare(null);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    const location = locations.find(l => l.id === id);
    await confirm({
      type: 'delete',
      itemType: 'location',
      itemName: location?.title || 'this location',
      description: 'This will permanently delete this location. This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteLocation(id);
          showSuccess('Location deleted successfully');
        } catch {
          showError('Failed to delete location');
        }
      },
    });
  }, [locations, confirm, deleteLocation, showSuccess, showError]);

  const handleCopy = useCallback(async (id: number) => {
    try {
      await copyLocation(id);
      showSuccess('Location duplicated successfully');
    } catch {
      showError('Failed to duplicate location');
    }
  }, [copyLocation, showSuccess, showError]);

  const handleTogglePublic = useCallback(async (id: number, isPublic: boolean) => {
    try {
      await togglePublic(id, isPublic);
      showSuccess(isPublic ? t('locations.toggle.nowPublic') : t('locations.toggle.nowPrivate'));
    } catch {
      showError('Failed to update location visibility');
    }
  }, [togglePublic, showSuccess, showError, t]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetchLocations();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [refetchLocations]);

  const filteredLocations = locations.filter((loc) =>
    loc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.f_class.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPublicLocations = publicLocations.filter((loc) =>
    loc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.f_class.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Stats
  const totalArea = locations.reduce((sum, loc) => sum + loc.area, 0);
  const totalDemand = locations.reduce((sum, loc) => sum + loc.demand_energy, 0);
  const publicCount = locations.filter(l => l.is_public).length;

  const renderEmptyState = (isPublicTab: boolean) => (
    <div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        {isPublicTab ? (
          <Globe className="h-7 w-7 text-muted-foreground" />
        ) : (
          <MapPin className="h-7 w-7 text-muted-foreground" />
        )}
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        {isPublicTab ? t('locations.empty.publicTitle') : t('locations.empty.title')}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {isPublicTab ? t('locations.empty.publicDescription') : t('locations.empty.description')}
      </p>
      {!isPublicTab && (
        <button onClick={handleCreateNew} className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}>
          <Plus className="h-4 w-4" />
          {t('locations.newLocation')}
        </button>
      )}
    </div>
  );

  const renderLocationList = (items: CustomLocation[], isPublicTab: boolean) => {
    if (items.length === 0) return renderEmptyState(isPublicTab);

    return (
      <div className="md-fade-in overflow-hidden rounded-xl border border-border">
        <div className="divide-y divide-border bg-card">
          {items.map((location, index) => (
            <LocationRow
              key={location.id}
              location={location}
              index={index}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onCopy={handleCopy}
              onShare={handleShare}
              onTogglePublic={handleTogglePublic}
              showPublicToggle={!isPublicTab}
              isOwner={!isPublicTab}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={PAGE_SHELL_CLASS}>
      <Notification
        isOpen={notification.open}
        message={notification.message}
        severity={notification.severity}
        onClose={hideNotification}
      />

      <PageHeader
        icon={MapPinned}
        title={t('locations.title')}
        subtitle={t('locations.subtitle')}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing || isLoading}
                  className={TOOLBAR_ICON_BUTTON_CLASS}
                  aria-label={t('locations.refresh')}
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing || isLoading ? 'animate-spin' : ''}`} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('locations.refresh')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCreateNew}
                  data-tour="new-location"
                  className={PRIMARY_BUTTON_CLASS}
                >
                  <Plus className="h-4 w-4" />
                  {t('locations.newLocation')}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('locations.newLocationTooltip')}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {/* Main Content Card */}
      <div className={`md-rise ${CARD_CLASS}`} style={{ animationDelay: '60ms' }}>
        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-4 sm:px-5">
          {/* Search */}
          <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('locations.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={SEARCH_INPUT_CLASS}
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-shrink-0">
            <TabsList className="h-9">
              <TabsTrigger key="my" value="my" className="text-xs px-3">
                <Lock className="w-3.5 h-3.5 mr-1.5" />
                {t('locations.tabs.my')} ({filteredLocations.length})
              </TabsTrigger>
              <TabsTrigger key="public" value="public" className="text-xs px-3">
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                {t('locations.tabs.public')} ({filteredPublicLocations.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Compact stats summary, in the toolbar */}
          <StatsStrip
            className="max-sm:w-full sm:ml-auto"
            items={[
              { label: t('locations.stats.total'), value: locations.length },
              { label: t('locations.stats.totalArea'), value: formatArea(totalArea) },
              { label: t('locations.stats.totalDemand'), value: `${(totalDemand / 1000).toFixed(0)} MWh` },
              { label: t('locations.stats.public'), value: publicCount },
            ]}
          />
        </div>

        {/* Content */}
        <div className="border-t border-border p-4 sm:px-5 sm:pb-5">
          {isLoading ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>{t('common.loading')}</span>
              </div>
              <ListSkeleton />
            </div>
          ) : (
            renderLocationList(
              activeTab === 'my' ? filteredLocations : filteredPublicLocations,
              activeTab !== 'my'
            )
          )}
        </div>
      </div>

      {/* Share Dialog */}
      <LocationShareDialog
        isOpen={shareDialogOpen}
        location={selectedLocationForShare}
        onClose={handleCloseShareDialog}
      />
    </div>
  );
};

export default LocationsPage;
