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
  Building2,
  Zap,
  MapPinned,
  Loader2,
  Share2
} from 'lucide-react';
import { useCustomLocationStore } from '@/features/locations/store/custom-location-store';
import type { CustomLocation } from '@/features/locations/services/customLocationService';
import StatCard from '@/components/ui/cards/StatCard';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import Notification from '@/components/ui/Notification';
import { useConfirm } from '@/hooks/useConfirmDialog';
import ModelActionGroup from '@/components/shared/ModelActionGroup';
import { LocationShareDialog } from './LocationShareDialog';
import {
  Button,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@spatialhub/ui';

const LocationCard: FC<{
  location: CustomLocation;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onCopy: (id: number) => void;
  onShare: (location: CustomLocation) => void;
  onTogglePublic: (id: number, isPublic: boolean) => void;
  showPublicToggle?: boolean;
  isOwner?: boolean;
}> = ({ location, onView, onEdit, onDelete, onCopy, onShare, onTogglePublic, showPublicToggle = true, isOwner = true }) => {
  const { t } = useTranslation();
  return (
    <div className="group flex items-center gap-2 bg-card rounded border border-border px-2.5 py-1.5 hover:bg-muted/30 transition-colors">
      {/* Icon */}
      <div className="p-1 bg-muted rounded flex-shrink-0">
        <MapPin className="w-3 h-3 text-muted-foreground" />
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground truncate max-w-[140px]" title={location.title}>
          {location.title}
        </span>
        <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground capitalize flex-shrink-0">
          {location.f_class}
        </span>
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0">
        <span className="font-medium text-foreground">
          {location.area > 10000 ? `${(location.area / 1000000).toFixed(1)}km²` : `${(location.area / 1000).toFixed(1)}k m²`}
        </span>
        <span>•</span>
        <span className="font-medium text-foreground">{(location.demand_energy / 1000).toFixed(0)}MWh</span>
      </div>

      {/* Public/Private Switch */}
      {showPublicToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center flex-shrink-0 scale-[0.55] origin-center">
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

  return (
      <div className="relative p-4 w-full space-y-4 bg-background overflow-x-hidden">
          <Notification 
            isOpen={notification.open} 
            message={notification.message} 
            severity={notification.severity} 
            onClose={hideNotification} 
          />

          {/* Header Section */}
          <div className="relative bg-card py-4 border border-border rounded-lg px-5 shadow-sm">
            <div className="w-full flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <MapPinned className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">{t('locations.title')}</h1>
                  <p className="text-xs text-muted-foreground">{t('locations.subtitle')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshing || isLoading}
                      className="p-2.5 border border-border rounded-xl hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-card"
                      aria-label={t('locations.refresh')}
                    >
                      <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('locations.refresh')}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCreateNew}
                      data-tour="new-location"
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm hover:shadow-md"
                    >
                      <Plus className="w-4 h-4" />
                      {t('locations.newLocation')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('locations.newLocationTooltip')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              key="total-locations"
              title={t('locations.stats.total')}
              value={locations.length}
              icon={<MapPin className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              key="total-area"
              title={t('locations.stats.totalArea')}
              value={totalArea > 1000000 ? `${(totalArea / 1000000).toFixed(1)} km²` : `${(totalArea / 1000).toFixed(1)} k m²`}
              icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              key="total-demand"
              title={t('locations.stats.totalDemand')}
              value={`${(totalDemand / 1000).toFixed(0)} MWh`}
              icon={<Zap className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              key="public-count"
              title={t('locations.stats.public')}
              value={publicCount}
              icon={<Globe className="w-4 h-4 text-muted-foreground" />}
            />
          </div>

          {/* Main Content Card */}
          <div className="bg-card rounded-lg shadow-sm border border-border">
            <div className="p-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {/* Search */}
                <div className="flex-1 min-w-[200px] max-w-md">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <input
                      type="text"
                      placeholder={t('locations.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-background hover:bg-accent focus:bg-background transition-colors text-sm text-foreground placeholder-muted-foreground"
                    />
                  </div>
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
              </div>

              {/* Content */}
              {(() => {
                if (isLoading) {
                  return (
                    <div className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">Loading locations...</p>
                      </div>
                    </div>
                  );
                }
                if (activeTab === 'my') {
                  if (filteredLocations.length === 0) {
                    return (
                      <div className="text-center py-16">
                        <div className="p-4 bg-muted rounded-full w-fit mx-auto mb-4">
                          <MapPin className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium text-foreground mb-2">No locations yet</h3>
                        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                          Create your first custom location to define areas with building classifications for energy simulations.
                        </p>
                        <Button onClick={handleCreateNew} className="gap-2">
                          <Plus className="w-4 h-4" />
                          Create Location
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      {filteredLocations.map((location) => (
                        <LocationCard
                          key={location.id}
                          location={location}
                          onView={handleView}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onCopy={handleCopy}
                          onShare={handleShare}
                          onTogglePublic={handleTogglePublic}
                        />
                      ))}
                    </div>
                  );
                }
                // Public tab
                if (filteredPublicLocations.length === 0) {
                  return (
                    <div className="text-center py-16">
                      <div className="p-4 bg-muted rounded-full w-fit mx-auto mb-4">
                        <Globe className="w-8 h-8 text-muted-foreground" />
                      </div>
                      <h3 className="text-lg font-medium text-foreground mb-2">{t('locations.empty.publicTitle')}</h3>
                      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        {t('locations.empty.publicDescription')}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-1.5">
                    {filteredPublicLocations.map((location) => (
                      <LocationCard
                        key={location.id}
                        location={location}
                        onView={handleView}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onCopy={handleCopy}
                        onShare={handleShare}
                        onTogglePublic={handleTogglePublic}
                        showPublicToggle={false}
                        isOwner={false}
                      />
                    ))}
                  </div>
                );
              })()}
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
