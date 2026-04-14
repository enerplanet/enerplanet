import { useEffect, useRef, useState, useCallback, forwardRef } from "react";
import { useTranslation } from "@spatialhub/i18n";
import {
  Battery,
  Sun,
  Wind,
  Leaf,
  Flame,
  Droplets,
  Home,
  Building2,
  Settings2,
  LucideIcon,
  Microchip,
  Loader2,
  Upload,
  Plus,
  FileText,
  User,
  MemoryStick,
  CircuitBoard,
  RefreshCw,
  GripVertical,
  DatabaseBackup,
  SolarPanel,
} from "lucide-react";
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { useForm, type FormDataConvertible, type FormDataType } from "@/hooks/useForm";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import { useAuthStore } from "@/store/auth-store";
import { isExpert } from "@/features/admin-dashboard/utils/accessLevelUtils";
import StatCard from "@/components/ui/cards/StatCard";
import Notification from "@/components/ui/Notification";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import AddParameterModal from "./components/AddParameterModal";
import AddTechnologyModal from "./components/AddTechnologyModal";
import CopyTechnologyModal from "./components/CopyTechnologyModal";
import ImportTechnologiesModal from "./components/ImportTechnologiesModal";
import TechnologyDetailsModal from "./components/TechnologyDetailsModal";
import TechnologiesSection from "./components/TechnologiesSection";
import technologyService, { Technology, TechnologyConstraint } from "@/features/technologies/services/technologyService";

// Custom WindTurbine icon component using the SVG file
const WindTurbine = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Tower */}
      <path d="M12 11V22"/>
      <path d="M10 22h4"/>
      {/* Hub */}
      <circle cx="12" cy="9" r="1.5" fill="currentColor"/>
      {/* Top blade */}
      <path d="M12 7.5L11 2C11 1 12 1 12.5 2L12 7.5" fill="currentColor" stroke="none"/>
      {/* Bottom-left blade */}
      <path d="M10.8 10L5 12C4 12.3 4.2 11.3 5 11L10.8 10" fill="currentColor" stroke="none"/>
      {/* Bottom-right blade */}
      <path d="M13.2 10L19 12C20 12.3 19.8 11.3 19 11L13.2 10" fill="currentColor" stroke="none"/>
    </svg>
  )
);
WindTurbine.displayName = "WindTurbine";

interface TechnologiesData {
  technologies: Technology[];
}

const iconMap: Record<string, LucideIcon> = {
  battery: Battery,
  sun: Sun,
  wind: Wind,
  leaf: Leaf,
  flame: Flame,
  droplets: Droplets,
  home: Home,
  "building-2": Building2,
  "solar-panel": SolarPanel,
  "wind-turbine": WindTurbine as unknown as LucideIcon,
};

const iconOptions = [
  { value: "battery", label: "Battery", icon: Battery },
  { value: "solar-panel", label: "Solar Panel", icon: SolarPanel },
  { value: "wind-turbine", label: "Wind Turbine", icon: WindTurbine },
  { value: "sun", label: "Sun", icon: Sun },
  { value: "wind", label: "Wind", icon: Wind },
  { value: "leaf", label: "Leaf", icon: Leaf },
  { value: "flame", label: "Flame", icon: Flame },
  { value: "droplets", label: "Droplets", icon: Droplets },
  { value: "home", label: "Home", icon: Home },
  { value: "building-2", label: "Building", icon: Building2 },
];

const emptyConstraint: TechnologyConstraint = {
  key: "",
  alias: "",
  default_value: 0,
  unit: null,
  min: null,
  max: null,
};

// Helper to update technology in array by key
const updateTechByKey = (techs: Technology[], key: string, updated: Technology): Technology[] =>
  techs.map((t) => (t.key === key ? updated : t));

// Helper to remove technology from array by key
const removeTechByKey = (techs: Technology[], key: string): Technology[] =>
  techs.filter((t) => t.key !== key);

interface TechnologyFormData extends FormDataType {
  key: string;
  alias: string;
  icon: string;
  description: string;
}

const validateTechnologyForm = (values: Record<string, unknown>): Record<string, string> => {
  const errors: Record<string, string> = {};

  const key = typeof values.key === "string" ? values.key : "";
  if (!key.trim()) {
    errors.key = "Key is required";
  }

  const alias = typeof values.alias === "string" ? values.alias : "";
  if (!alias.trim()) {
    errors.alias = "Display name is required";
  }

  return errors;
};

export default function TechnologiesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('technologies.title'), " | EnerPlanET");
  const confirm = useConfirm();
  const { notification, showSuccess, showError, hide: hideNotification } = useNotification();
  const user = useAuthStore((state) => state.user);

  const [technologies, setTechnologies] = useState<Technology[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTech, setSelectedTech] = useState<Technology | null>(null);
  const [editedConstraints, setEditedConstraints] = useState<TechnologyConstraint[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddParamModal, setShowAddParamModal] = useState(false);
  const [newTechConstraints, setNewTechConstraints] = useState<TechnologyConstraint[]>([{ ...emptyConstraint }]);
  const [newParam, setNewParam] = useState<TechnologyConstraint>({ ...emptyConstraint });
  const [addingParam, setAddingParam] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const [deletingConstraint, setDeletingConstraint] = useState<number | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [techToCopy, setTechToCopy] = useState<Technology | null>(null);
  const [copyKey, setCopyKey] = useState("");
  const [copyAlias, setCopyAlias] = useState("");
  const [copying, setCopying] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importAsSystem, setImportAsSystem] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<TechnologiesData | null>(null);
  const [draggedTech, setDraggedTech] = useState<Technology | null>(null);
  const [dragOverSection, setDragOverSection] = useState<"system" | "user" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const techForm = useForm<TechnologyFormData>({
    key: "",
    alias: "",
    icon: "battery",
    description: "",
  });

  const isOwnTechnology = (tech: Technology) => Boolean(tech.user_id && user && tech.user_id === String(user.id));
  const canEditTech = (tech: Technology) => (isExpert(user) ? true : isOwnTechnology(tech));
  const canDeleteTech = (tech: Technology) => (isExpert(user) ? true : isOwnTechnology(tech));
  const canDeleteConstraint = (tech: Technology) => (isExpert(user) ? true : tech.user_id === user?.id);

  const loadTechnologies = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const data = await technologyService.getAll();
        setTechnologies(data || []);
      } catch {
        const response = await fetch("/initial-data/techs/default_technologies.json");
        if (!response.ok) {
          throw new Error("Failed to load technologies");
        }
        const data: TechnologiesData = await response.json();
        setTechnologies(data.technologies);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (isRefresh) {
        setTimeout(() => setIsRefreshing(false), 500);
      } else {
        setLoading(false);
      }
    }
  }, [showError]);

  const handleRefresh = async () => {
    await loadTechnologies(true);
  };

  useEffect(() => {
    loadTechnologies();
  }, [loadTechnologies]);

  const formatValue = (value: number | string) => {
    if (typeof value === "string" && value === "INF") return "∞";
    if (typeof value === "number") {
      return value % 1 === 0 ? value.toString() : value.toFixed(4);
    }
    return value;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const readFile = async () => {
      try {
        const content = await file.text();
        const data: TechnologiesData = JSON.parse(content);

        if (data.technologies && Array.isArray(data.technologies)) {
          if (isExpert(user)) {
            setPendingImportData(data);
            setImportAsSystem(false);
            setShowImportModal(true);
          } else {
            await performImport(data, false);
          }
        } else {
          showError(t('technologies.error.invalidFile'));
        }
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        showError(error.response?.data?.error || t('technologies.error.invalidFile'));
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    readFile();
  };

  const performImport = async (data: TechnologiesData, asSystem: boolean) => {
    setImporting(true);
    try {
      const result = await technologyService.importFromJson(data.technologies, asSystem);

      if (result.imported > 0 || result.skipped > 0) {
        await loadTechnologies();
        showSuccess(t('technologies.success.imported', { count: result.imported }));
      }
      setShowImportModal(false);
      setPendingImportData(null);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.error.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const parseNumericConstraint = (c: Partial<TechnologyConstraint>): any => {
    return {
      ...c,
      default_value: typeof c.default_value === 'string' && c.default_value !== '' && !isNaN(Number(c.default_value)) ? Number(c.default_value) : c.default_value,
      min: typeof c.min === 'string' && c.min !== '' && !isNaN(Number(c.min)) ? Number(c.min) : c.min,
      max: typeof c.max === 'string' && c.max !== '' && c.max !== 'INF' && c.max !== '∞' && !isNaN(Number(c.max)) ? Number(c.max) : c.max,
    };
  };

  const handleAddTechnology = async () => {
    const validationErrors = validateTechnologyForm(techForm.data);

    if (Object.keys(validationErrors).length > 0) {
      techForm.setError(validationErrors as Partial<Record<keyof TechnologyFormData, string>>);
      return;
    }

    if (technologies.some((t) => t.key === techForm.data.key)) {
      showError(t('technologies.error.addFailed'));
      handleCloseAddModal();
      return;
    }

    try {
      const newTech: Technology = {
        key: techForm.data.key,
        alias: techForm.data.alias,
        icon: techForm.data.icon,
        description: techForm.data.description,
        constraints: newTechConstraints.filter((c) => c.key && c.alias).map(parseNumericConstraint),
      };

      const created = await technologyService.create(newTech);
      setTechnologies((prev) => [...prev, created]);
      handleCloseAddModal();
      showSuccess(t('technologies.success.added', { name: techForm.data.alias }));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.error.addFailed'));
    }
  };

  const handleCloseAddModal = () => {
    if (!techForm.isLoading) {
      techForm.reset();
      setNewTechConstraints([{ ...emptyConstraint }]);
      setShowAddModal(false);
    }
  };

  const handleFormChange = (key: string, value: FormDataConvertible) => {
    techForm.setData(key as keyof TechnologyFormData, value);
    if (techForm.errors[key as keyof TechnologyFormData]) {
      techForm.clearErrors(key as keyof TechnologyFormData);
    }
  };

  const handleDeleteTechnology = async (tech: Technology) => {
    if (!tech.id) {
      showError(t('technologies.error.deleteFailed'));
      return;
    }

    await confirm({
      type: "delete",
      itemType: "technology",
      itemName: tech.alias,
      onConfirm: async () => {
        try {
          await technologyService.delete(tech.id!);
          setTechnologies((prev) => removeTechByKey(prev, tech.key));
          showSuccess(t('technologies.success.deleted', { name: tech.alias }));
        } catch (err: unknown) {
          const error = err as { response?: { data?: { error?: string } } };
          showError(error.response?.data?.error || t('technologies.error.deleteFailed'));
        }
      },
    });
  };

  const addConstraint = () => setNewTechConstraints((prev) => [...prev, { ...emptyConstraint }]);
  const removeConstraint = (index: number) => setNewTechConstraints((prev) => prev.filter((_, i) => i !== index));
  const updateConstraint = (index: number, field: keyof TechnologyConstraint, value: string | number | null) => {
    setNewTechConstraints((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const openTechDetails = (tech: Technology) => {
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur();
    setSelectedTech(tech);
    setEditedConstraints(tech.constraints.map((c) => ({ ...c })));
  };

  const updateEditedConstraint = (index: number, field: keyof TechnologyConstraint, value: string | number | null) => {
    setEditedConstraints((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const saveEditedConstraints = async () => {
    if (!selectedTech?.id) return;

    setSavingDetails(true);
    try {
      const payload = editedConstraints.map(parseNumericConstraint);
      const updated = await technologyService.updateConstraints(selectedTech.id, payload);
      setTechnologies((prev) => updateTechByKey(prev, selectedTech.key, updated));
      setSelectedTech(null);
      setEditingIndex(null);
      showSuccess(t('technologies.success.saved'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.error.saveFailed'));
    } finally {
      setSavingDetails(false);
    }
  };

  const handleAddParameter = async () => {
    if (!selectedTech?.id) return;
    if (!newParam.key || !newParam.alias) {
      showError(t('technologies.form.keyRequired'));
      return;
    }

    setAddingParam(true);
    try {
      const payload = parseNumericConstraint(newParam);
      const updated = await technologyService.addConstraint(selectedTech.id, payload);
      setTechnologies((prev) => updateTechByKey(prev, selectedTech.key, updated));
      setSelectedTech(updated);
      setEditedConstraints(updated.constraints.map((c) => ({ ...c })));
      setShowAddParamModal(false);
      setNewParam({ ...emptyConstraint });
      showSuccess(t('technologies.success.paramAdded', { name: newParam.alias }));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.error.paramAddFailed'));
    } finally {
      setAddingParam(false);
    }
  };

  const handleDeleteConstraint = async (constraintId: number, constraintAlias: string) => {
    if (!selectedTech?.id) return;

    await confirm({
      title: t('technologies.confirm.deleteParamTitle'),
      description: t('technologies.confirm.deleteParamMessage', { name: constraintAlias }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      type: "delete",
      onConfirm: async () => {
        setDeletingConstraint(constraintId);
        try {
          const updated = await technologyService.deleteConstraint(selectedTech.id!, constraintId);
          setTechnologies((prev) => updateTechByKey(prev, selectedTech.key, updated));
          setSelectedTech(updated);
          setEditedConstraints(updated.constraints.map((c) => ({ ...c })));
          showSuccess(t('technologies.success.paramDeleted', { name: constraintAlias }));
        } catch (err: unknown) {
          const error = err as { response?: { data?: { error?: string } } };
          showError(error.response?.data?.error || t('technologies.error.paramDeleteFailed'));
        } finally {
          setDeletingConstraint(null);
        }
      },
    });
  };

  const handleReseed = async () => {
    await confirm({
      title: t('technologies.reseed'),
      description: t('technologies.confirm.reseedMessage') || "This will reset all system technologies to their default values. User-defined technologies will not be affected. Are you sure?",
      confirmLabel: t('technologies.reseed'),
      cancelLabel: t('common.cancel'),
      type: "warning",
      onConfirm: async () => {
        setReseeding(true);
        try {
          await technologyService.reseed();
          await loadTechnologies(true);
          showSuccess(t('technologies.success.reseeded'));
        } catch (err: unknown) {
          const error = err as { response?: { data?: { error?: string }; status?: number }; message?: string };
          const errorMessage = error.response?.data?.error || error.message || t('technologies.error.reseedFailed');
          showError(errorMessage);
          await loadTechnologies(true);
        } finally {
          setReseeding(false);
        }
      },
    });
  };

  const canCopyTech = (tech: Technology) => (isExpert(user) ? true : tech.user_id === user?.id);

  const getNextVersion = (baseKey: string): { key: string; alias: string } => {
    const versionPattern = new RegExp(String.raw`^${baseKey}_v(\d+)$`);
    let maxVersion = 0;

    technologies.forEach((tech) => {
      const match = versionPattern.exec(tech.key);
      if (match) {
        const version = Number.parseInt(match[1], 10);
        if (version > maxVersion) maxVersion = version;
      }
    });

    const nextVersion = maxVersion + 1;
    const baseTech = technologies?.find((t) => t.key === baseKey);
    const baseAlias = baseTech?.alias || baseKey;

    return {
      key: `${baseKey}_v${nextVersion}`,
      alias: `${baseAlias} v${nextVersion}`,
    };
  };

  const openCopyModal = (tech: Technology) => {
    setTechToCopy(tech);
    const { key, alias } = getNextVersion(tech.key);
    setCopyKey(key);
    setCopyAlias(alias);
    setShowCopyModal(true);
  };

  const handleCopyTechnology = async () => {
    if (!techToCopy || !copyKey || !copyAlias) {
      showError(t('technologies.form.keyRequired'));
      return;
    }

    setCopying(true);
    try {
      const newTech = await technologyService.create({
        key: copyKey,
        alias: copyAlias,
        icon: techToCopy.icon,
        description: techToCopy.description,
        constraints: techToCopy.constraints.map((c) => ({
          key: c.key,
          alias: c.alias,
          description: c.description,
          default_value: c.default_value,
          unit: c.unit,
          min: c.min,
          max: c.max,
        })),
      });
      setTechnologies((prev) => [...prev, newTech]);
      setShowCopyModal(false);
      setTechToCopy(null);
      setCopyKey("");
      setCopyAlias("");
      showSuccess(t('technologies.success.copied', { name: copyAlias }));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.error.copyFailed'));
    } finally {
      setCopying(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isExpert(user)) return;
    const { active } = event;
    const activeId = String(active.id);
    const techId = activeId.includes(':') ? activeId.split(':')[1] : activeId;
    const tech = technologies.find((t) => (t.id?.toString() || t.key) === techId);
    if (tech) {
      setDraggedTech(tech);
    }
  }, [technologies, user]);

  const handleDragOver = useCallback((event: { over: { id: string | number } | null }) => {
    if (!isExpert(user) || !draggedTech) return;
    const { over } = event;
    
    if (over) {
      const overId = String(over.id);
      if (over.id === "system") {
        setDragOverSection("system");
      } else if (over.id === "user") {
        setDragOverSection("user");
      } else if (overId.startsWith("system:")) {
        setDragOverSection("system");
      } else if (overId.startsWith("user:")) {
        setDragOverSection("user");
      } else {
        setDragOverSection(null);
      }
    } else {
      setDragOverSection(null);
    }
  }, [draggedTech, user]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { over } = event;
    setDragOverSection(null);

    if (!isExpert(user) || !draggedTech) {
      setDraggedTech(null);
      return;
    }

    // Determine target section from the over ID
    let targetSection: "system" | "user" | null = null;
    
    if (over?.id === "system") {
      targetSection = "system";
    } else if (over?.id === "user") {
      targetSection = "user";
    } else if (over?.id) {
      const overId = String(over.id);
      if (overId.startsWith("system:")) {
        targetSection = "system";
      } else if (overId.startsWith("user:")) {
        targetSection = "user";
      }
    }
    
    if (!targetSection) {
      setDraggedTech(null);
      return;
    }

    const isCurrentlySystem = !draggedTech.user_id;
    const targetIsSystem = targetSection === "system";

    if (isCurrentlySystem === targetIsSystem) {
      setDraggedTech(null);
      return;
    }

    try {
      const updatedTech = await technologyService.updateType(draggedTech.id!, targetIsSystem);
      setTechnologies((prev) => prev.map((t) => (t.id === draggedTech.id ? updatedTech : t)));
      showSuccess(t('technologies.movedTo', { name: draggedTech.alias, target: targetIsSystem ? t('technologies.stats.systemTechnologies') : t('technologies.stats.userTechnologies') }));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      showError(error.response?.data?.error || t('technologies.failedToMove'));
    } finally {
      setDraggedTech(null);
    }
  }, [draggedTech, user, showSuccess, showError, t]);

  const handleDragCancel = useCallback(() => {
    setDraggedTech(null);
    setDragOverSection(null);
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('technologies.loading')}</p>
        </div>
      </div>
    );
  }

  const systemTechnologies = technologies.filter((t) => !t.user_id);
  const userTechnologies = technologies.filter((t) => !!t.user_id);

  return (
    <div className="relative w-full p-4 space-y-4 bg-background overflow-x-hidden">
        <Notification isOpen={notification.open} message={notification.message} severity={notification.severity} onClose={hideNotification} />

        <div className="relative bg-card py-4 border border-border rounded-lg px-5 shadow-sm mb-4">
          <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Microchip className="w-5 h-5 text-black dark:text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">{t('technologies.title')}</h1>
                <p className="text-xs text-muted-foreground">{t('technologies.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing || loading}
                    className="p-2.5 border border-border rounded-xl hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-card"
                    aria-label="Refresh technologies"
                  >
                    <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('technologies.refresh')}</TooltipContent>
              </Tooltip>

              {isExpert(user) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleReseed}
                      disabled={reseeding}
                      className="p-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors duration-200 disabled:opacity-50"
                      aria-label="Reseed system technologies"
                    >
                      <DatabaseBackup className={`w-4 h-4 ${reseeding ? "animate-pulse" : ""}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('technologies.reseed')}</TooltipContent>
                </Tooltip>
              )}

              <a
                href="/docs/technology-reference-guide.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-all"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">{t('technologies.documentation')}</span>
              </a>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-all"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">{t('technologies.importJson')}</span>
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm hover:shadow-md"
              >
                <Plus className="w-4 h-4" />
                {t('technologies.addTechnology')}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard title={t('technologies.stats.totalTechnologies')} value={technologies?.length ?? 0} icon={<MemoryStick className="w-4 h-4 text-muted-foreground" />} />
          <StatCard title={t('technologies.stats.systemTechnologies')} value={systemTechnologies?.length ?? 0} icon={<Sun className="w-4 h-4 text-muted-foreground" />} />
          <StatCard title={t('technologies.stats.userTechnologies')} value={userTechnologies?.length ?? 0} icon={<Battery className="w-4 h-4 text-muted-foreground" />} />
          <StatCard title={t('technologies.stats.totalParameters')} value={technologies?.reduce((sum, t) => sum + (t.constraints?.length ?? 0), 0) ?? 0} icon={<Settings2 className="w-4 h-4 text-muted-foreground" />} />
        </div>

        {isExpert(user) && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <GripVertical className="w-3 h-3" />
            {t('technologies.dragDropHint')}
          </p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <TechnologiesSection
            title={t('technologies.systemTechnologies')}
            sectionKey="system"
          technologies={systemTechnologies}
          icon={<CircuitBoard className="w-4 h-4" />}
          isExpert={isExpert(user)}
          draggedTech={draggedTech}
          dragOverSection={dragOverSection}
          iconMap={iconMap}
          canCopyTech={canCopyTech}
          canDeleteTech={canDeleteTech}
          isOwnTechnology={isOwnTechnology}
          openTechDetails={openTechDetails}
          openCopyModal={openCopyModal}
          handleDeleteTechnology={handleDeleteTechnology}
        />

          <TechnologiesSection
            title={t('technologies.userDefinedTechnologies')}
            sectionKey="user"
          technologies={userTechnologies}
          icon={<User className="w-4 h-4" />}
          isExpert={isExpert(user)}
          draggedTech={draggedTech}
          dragOverSection={dragOverSection}
          iconMap={iconMap}
          canCopyTech={canCopyTech}
          canDeleteTech={canDeleteTech}
          isOwnTechnology={isOwnTechnology}
          openTechDetails={openTechDetails}
          openCopyModal={openCopyModal}
          handleDeleteTechnology={handleDeleteTechnology}
        />

          <DragOverlay>
            {draggedTech ? (
              <div className="bg-card rounded-xl border-2 border-primary p-4 shadow-xl opacity-90">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    {(() => {
                      const IconComponent = iconMap[draggedTech.icon] || CircuitBoard;
                      return <IconComponent className="w-5 h-5 text-gray-600 dark:text-gray-400" />;
                    })()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">{draggedTech.alias}</h3>
                    <p className="text-xs text-muted-foreground">{draggedTech.constraints.length} {t('technologies.parameters')}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <TechnologyDetailsModal
          open={!!selectedTech}
          selectedTech={selectedTech}
          onClose={() => {
            setSelectedTech(null);
            setEditingIndex(null);
          }}
          editedConstraints={editedConstraints}
          editingIndex={editingIndex}
          setEditingIndex={setEditingIndex}
          updateEditedConstraint={updateEditedConstraint}
          formatValue={formatValue}
          canEditTech={canEditTech}
          canDeleteConstraint={canDeleteConstraint}
          handleDeleteConstraint={handleDeleteConstraint}
          deletingConstraint={deletingConstraint}
          saveEditedConstraints={saveEditedConstraints}
          setShowAddParamModal={setShowAddParamModal}
          iconMap={iconMap}
          savingDetails={savingDetails}
        />

        <AddTechnologyModal
          open={showAddModal}
          onClose={handleCloseAddModal}
          onSubmit={handleAddTechnology}
          techForm={techForm}
          onFieldChange={(key, value) => handleFormChange(key as string, value)}
          iconOptions={iconOptions}
          newTechConstraints={newTechConstraints}
          addConstraint={addConstraint}
          removeConstraint={removeConstraint}
          updateConstraint={updateConstraint}
        />

        <AddParameterModal
          open={showAddParamModal}
          onClose={() => {
            setShowAddParamModal(false);
            setNewParam({ ...emptyConstraint });
          }}
          onSubmit={handleAddParameter}
          selectedTech={selectedTech}
          newParam={newParam}
          setNewParam={setNewParam}
          addingParam={addingParam}
        />

        <CopyTechnologyModal
          open={showCopyModal}
          onClose={() => {
            setShowCopyModal(false);
            setTechToCopy(null);
            setCopyKey("");
            setCopyAlias("");
          }}
          techToCopy={techToCopy}
          copyKey={copyKey}
          setCopyKey={setCopyKey}
          copyAlias={copyAlias}
          setCopyAlias={setCopyAlias}
          copying={copying}
          onCopy={handleCopyTechnology}
        />

        <ImportTechnologiesModal
          open={showImportModal}
          onClose={() => {
            setShowImportModal(false);
            setPendingImportData(null);
          }}
          pendingCount={pendingImportData?.technologies.length || 0}
          importAsSystem={importAsSystem}
          setImportAsSystem={setImportAsSystem}
          importing={importing}
          onImport={() => pendingImportData && performImport(pendingImportData, importAsSystem)}
        />
    </div>
  );
}
