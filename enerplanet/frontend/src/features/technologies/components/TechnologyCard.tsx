import { ReactElement } from "react";
import { Eye, Copy, Trash2, User } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Technology } from "@/features/technologies/services/technologyService";

interface TechnologyCardProps {
  tech: Technology;
  Icon: ReactElement;
  isOwnTechnology?: boolean;
  canCopy: boolean;
  canDelete: boolean;
  dragged?: boolean;
  onView: (tech: Technology) => void;
  onCopy?: (tech: Technology) => void;
  onDelete?: (tech: Technology) => void;
}

function TechnologyCard({
  tech,
  Icon,
  isOwnTechnology,
  canCopy,
  canDelete,
  dragged,
  onView,
  onCopy,
  onDelete,
}: Readonly<TechnologyCardProps>) {
  const { t } = useTranslation();
  
  // Get translated name and description if available, fallback to database values
  const techName = t(`technologies.items.${tech.key}.name`, { defaultValue: tech.alias });
  const techDescription = t(`technologies.items.${tech.key}.description`, { defaultValue: tech.description });
  
  return (
    <div
      className={`group bg-card rounded-xl border border-border p-4 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 ${
        dragged ? "opacity-50 shadow-lg ring-2 ring-primary" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
          {Icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground truncate">{techName}</h3>
            {isOwnTechnology !== undefined && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      isOwnTechnology
                        ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    <User className="w-2.5 h-2.5" />
                    {isOwnTechnology ? t('technologies.mine') : t('technologies.user')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isOwnTechnology ? t('technologies.youCreatedThis') : t('technologies.userDefined')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{techDescription}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
          {tech.constraints.length} {t('technologies.parameters')}
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => onView(tech)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('technologies.viewParameters')}</TooltipContent>
          </Tooltip>
          {canCopy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onCopy?.(tech)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('technologies.copyTechnology')}</TooltipContent>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDelete?.(tech)}
                  className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('technologies.deleteTechnology')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

interface SortableTechnologyCardProps extends TechnologyCardProps {
  sectionKey: "system" | "user";
  isExpert?: boolean;
}

export function SortableTechnologyCard(props: Readonly<SortableTechnologyCardProps>) {
  // Include sectionKey in the ID so we can parse it on drop
  const sortableId = `${props.sectionKey}:${props.tech.id?.toString() || props.tech.key}`;
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      {...(props.isExpert ? { ...attributes, ...listeners } : {})}
      className={props.isExpert ? "cursor-grab active:cursor-grabbing" : ""}
    >
      <TechnologyCard
        {...props}
        dragged={isDragging || props.dragged}
      />
    </div>
  );
}


