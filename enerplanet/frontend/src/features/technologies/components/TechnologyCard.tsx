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
  /** Position in the grid, used to stagger the entrance animation. */
  index?: number;
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
  index = 0,
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
      className={`md-rise group rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-md ${
        dragged ? "opacity-50 shadow-lg ring-2 ring-primary" : ""
      }`}
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
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
        <span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
          {tech.constraints.length} {t('technologies.parameters')}
        </span>
        <div className="flex items-center gap-1 transition-opacity duration-150 sm:opacity-80 sm:group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onView(tech)}
                className="rounded-lg p-1.5 transition-all duration-150 hover:bg-muted active:scale-95"
              >
                <Eye className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('technologies.viewParameters')}</TooltipContent>
          </Tooltip>
          {canCopy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onCopy?.(tech)}
                  className="rounded-lg p-1.5 transition-all duration-150 hover:bg-muted active:scale-95"
                >
                  <Copy className="h-4 w-4 text-muted-foreground" />
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
                  className="group/delete rounded-lg p-1.5 transition-all duration-150 hover:bg-destructive/10 active:scale-95"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground transition-colors group-hover/delete:text-destructive" />
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


