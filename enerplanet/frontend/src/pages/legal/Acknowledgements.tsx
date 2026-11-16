import React from "react";
import { Heart, Monitor, Server, Activity, Database } from "lucide-react";

type Section = {
  id: string;
  title: string;
  icon: typeof Heart;
  items: React.ReactNode[];
};

const SECTIONS: Section[] = [
  {
    id: "frontend",
    title: "Frontend",
    icon: Monitor,
    items: [
      <>
        <strong>React</strong> and <strong>TypeScript</strong>: The UI library and typed language
        underlying the web application.
      </>,
      <>
        <strong>MapLibre GL JS</strong> and <strong>OpenLayers</strong>: Mapping libraries powering
        3D building visualization and geospatial analysis.
      </>,
      <>
        <strong>ECharts</strong> and <strong>Turf.js</strong>: Visualization and geospatial
        computation for energy system results.
      </>,
      <>
        <strong>TailwindCSS</strong>, <strong>Radix UI</strong> and <strong>Lucide</strong>: Styling,
        accessible components, and icons.
      </>,
      <>
        <strong>i18next</strong> and <strong>Carto</strong>: Multilingual support and basemap tiles.
      </>,
    ],
  },
  {
    id: "backend",
    title: "Backend & Infrastructure",
    icon: Server,
    items: [
      <>
        <strong>Go (Gin)</strong>, <strong>PostgreSQL</strong>, <strong>PostGIS</strong> and{" "}
        <strong>pgRouting</strong>: The backend runtime, relational database, and spatial routing
        extensions.
      </>,
      <>
        <strong>Redis</strong>, <strong>Keycloak</strong> and <strong>Nginx</strong>: Caching,
        authentication, and reverse proxy.
      </>,
      <>
        <strong>Docker</strong> and <strong>GeoServer</strong>: Deployment orchestration and
        geospatial data sharing.
      </>,
    ],
  },
  {
    id: "simulation",
    title: "Simulation & Optimization",
    icon: Activity,
    items: [
      <>
        <strong>Calliope</strong> and <strong>PyPSA</strong>: Energy system and power flow modeling
        frameworks.
      </>,
      <>
        <strong>NREL PySAM</strong> and <strong>PVLib</strong>: Renewable energy performance and
        financial modeling.
      </>,
      <>
        <strong>PyLovo</strong>: Grid generation and AI-based demand estimation.
      </>,
    ],
  },
  {
    id: "data",
    title: "Data Sources",
    icon: Database,
    items: [
      <>
        <strong>OpenStreetMap</strong>: Collaborative geographic data forming the base of our
        spatial analyses.
      </>,
      <>
        <strong>MERRA-2</strong> and <strong>Open-Meteo</strong>: Atmospheric and weather data for
        simulations and environmental display.
      </>,
      <>
        <strong>3D BAG</strong>, <strong>EUBUCCO</strong> and <strong>CBS</strong>: Building
        geometry, stock, and demographic data.
      </>,
      <>
        <strong>EP-Online</strong> and <strong>MaStR</strong>: Building energy labels and market
        master data.
      </>,
    ],
  },
];

const Acknowledgements: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Heart className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Acknowledgements</h1>
            <p className="text-sm text-muted-foreground">Last updated: February 25, 2026</p>
          </div>
        </div>
        <p className="text-muted-foreground">
          EnerPlanET is built on the work of many open-source developers, researchers, and data
          providers. We are grateful for their continuous innovation and support in the field of
          energy modeling and analysis. The following highlights the projects and datasets that form
          the backbone of the platform; we also owe a debt to the many smaller libraries and
          contributors whose work we build upon every day.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section
              key={section.id}
              id={section.id}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{section.title}</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span className="text-sm leading-relaxed text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default Acknowledgements;
