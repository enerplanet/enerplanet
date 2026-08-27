import { ReactNode } from "react";
import { CircuitBoard, LucideIcon } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslation } from "@spatialhub/i18n";
import { SortableTechnologyCard } from "./TechnologyCard";
import { Technology } from "@/features/technologies/services/technologyService";

type SectionKey = "system" | "user";

interface TechnologiesSectionProps {
  title: string;
  sectionKey: SectionKey;
  technologies: Technology[];
  icon: ReactNode;
  isExpert: boolean;
  draggedTech: Technology | null;
  dragOverSection: SectionKey | null;
  iconMap: Record<string, LucideIcon>;
  canCopyTech: (tech: Technology) => boolean;
  canDeleteTech: (tech: Technology) => boolean;
  isOwnTechnology: (tech: Technology) => boolean;
  openTechDetails: (tech: Technology) => void;
  openCopyModal: (tech: Technology) => void;
  handleDeleteTechnology: (tech: Technology) => void;
}

function DroppableSection({
  sectionKey,
  children,
  isOver,
  isExpert,
  draggedTech,
}: Readonly<{
  sectionKey: SectionKey;
  children: ReactNode;
  isOver: boolean;
  isExpert: boolean;
  draggedTech: Technology | null;
}>) {
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: sectionKey,
  });

  return (
    <div
      ref={setNodeRef}
      data-section={sectionKey}
      className={`transition-all duration-200 min-h-[100px] ${
        (isOver || isDroppableOver) && isExpert && draggedTech ? "ring-2 ring-primary ring-offset-2 rounded-xl p-2 -m-2 bg-primary/5" : ""
      }`}
    >
      {children}
    </div>
  );
}

function TechnologiesSection({
  title,
  sectionKey,
  technologies,
  icon,
  isExpert,
  draggedTech,
  dragOverSection,
  iconMap,
  canCopyTech,
  canDeleteTech,
  isOwnTechnology,
  openTechDetails,
  openCopyModal,
  handleDeleteTechnology,
}: Readonly<TechnologiesSectionProps>) {
  const { t } = useTranslation();
  const isOver = dragOverSection === sectionKey;

  return (
    <DroppableSection
      sectionKey={sectionKey}
      isOver={isOver}
      isExpert={isExpert}
      draggedTech={draggedTech}
    >
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
          <span className="font-normal tabular-nums">({technologies.length})</span>
          {isExpert && draggedTech && (
            <span className="md-fade-in ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">
              {sectionKey === "system" ? t('technologies.dropToMakeSystem') : t('technologies.dropToMakeUser')}
            </span>
          )}
        </h2>
        {technologies.length === 0 ? (
          <div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
              <CircuitBoard className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{t('technologies.noTechnologies')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {technologies.map((tech, index) => {
              const IconComponent = iconMap[tech.icon] || CircuitBoard;

              return (
                <SortableTechnologyCard
                  key={tech.id?.toString() || tech.key}
                  tech={tech}
                  index={index}
                  sectionKey={sectionKey}
                  Icon={<IconComponent className="h-5 w-5 text-muted-foreground" />}
                  isExpert={isExpert}
                  isOwnTechnology={sectionKey === "user" ? isOwnTechnology(tech) : undefined}
                  canCopy={canCopyTech(tech)}
                  canDelete={canDeleteTech(tech)}
                  dragged={draggedTech?.id === tech.id}
                  onView={openTechDetails}
                  onCopy={openCopyModal}
                  onDelete={handleDeleteTechnology}
                />
              );
            })}
          </div>
        )}
      </div>
    </DroppableSection>
  );
}

export default TechnologiesSection;
