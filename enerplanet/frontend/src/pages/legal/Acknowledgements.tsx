import React from "react";
import { Heart } from "lucide-react";

const Acknowledgements: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Heart className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Acknowledgements</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: February 25, 2026</p>
      </header>
      <div className="prose prose-lg max-w-none text-foreground">
        <p>
          We would like to extend our gratitude to the developers and contributors of the following
          tools, frameworks and data sources, which help us provide a robust and accurate energy
          modeling platform for our users. Thank you for your continuous innovation and support in
          the field of energy modeling and analysis.
        </p>

        <h3 id="frontend">Frontend</h3>
        <ul className="wrap-break-words">
          <li>
            <strong>React</strong>: An open-source JavaScript library for building user interfaces,
            maintained by Meta and a community of developers.
          </li>
          <li>
            <strong>TypeScript</strong>: A strongly typed programming language that builds on
            JavaScript, providing better tooling and developer experience.
          </li>
          <li>
            <strong>MapLibre GL JS</strong>: An open-source mapping library for rendering interactive
            2D and 3D maps with WebGL, used for 3D building visualization and spatial analysis.
          </li>
          <li>
            <strong>OpenLayers</strong>: A powerful open-source mapping library for creating dynamic
            and interactive 2D maps for visualizing energy models and geospatial data.
          </li>
          <li>
            <strong>ECharts</strong>: A comprehensive charting and visualization library for
            displaying energy system optimization results, power flow analysis, and simulation data.
          </li>
          <li>
            <strong>Turf.js</strong>: A modular geospatial analysis library for geometric
            calculations including area, buffer, and distance computations.
          </li>
          <li>
            <strong>TailwindCSS</strong>: A utility-first CSS framework for building modern,
            responsive user interfaces.
          </li>
          <li>
            <strong>Radix UI</strong>: An accessible, unstyled component library providing the
            foundation for our UI components.
          </li>
          <li>
            <strong>Lucide</strong>: A beautiful and consistent open-source icon library.
          </li>
          <li>
            <strong>i18next</strong>: An internationalization framework enabling multilingual support
            across 8 languages.
          </li>
          <li>
            <strong>Carto</strong>: Provides high-quality Positron basemap tiles that enhance the
            visual representation of our geographic data.
          </li>
        </ul>

        <h3 id="backend">Backend &amp; Infrastructure</h3>
        <ul className="wrap-break-words">
          <li>
            <strong>Go (Gin)</strong>: A high-performance backend runtime and web framework, providing
            fast and reliable API services.
          </li>
          <li>
            <strong>PostgreSQL</strong>: A powerful open-source relational database system known for
            its robustness, extensibility, and support for complex queries.
          </li>
          <li>
            <strong>PostGIS</strong>: A spatial database extender for PostgreSQL that enables the
            storage, query, and manipulation of geographic data.
          </li>
          <li>
            <strong>pgRouting</strong>: An extension for PostgreSQL that provides geospatial routing
            functionality, enabling shortest path and cable optimization calculations.
          </li>
          <li>
            <strong>Redis</strong>: An in-memory data store used for session management, caching, and
            task queue processing.
          </li>
          <li>
            <strong>Keycloak</strong>: An open-source identity and access management solution
            providing OAuth2/OIDC authentication.
          </li>
          <li>
            <strong>Nginx</strong>: A high-performance reverse proxy and web server handling SSL
            termination and request routing.
          </li>
          <li>
            <strong>Docker</strong>: Container platform for consistent deployment and orchestration of
            all platform services.
          </li>
          <li>
            <strong>GeoServer</strong>: An open-source server for sharing geospatial data via WMS and
            WFS services.
          </li>
        </ul>

        <h3 id="simulation">Simulation &amp; Optimization</h3>
        <ul className="wrap-break-words">
          <li>
            <strong>Calliope</strong>: A versatile energy system modeling framework that supports
            flexible and scalable energy system optimization.
          </li>
          <li>
            <strong>PyPSA</strong>: Python for Power System Analysis, an open-source tool for
            simulating and optimizing power systems with optimal power flow capabilities.
          </li>
          <li>
            <strong>NREL PySAM</strong>: The System Advisor Model (SAM) from the National Renewable
            Energy Laboratory, providing detailed performance and financial models for photovoltaic,
            wind, biomass, and geothermal energy systems.
          </li>
          <li>
            <strong>PVLib</strong>: A library of tools for simulating photovoltaic systems, enabling
            accurate solar energy performance analysis.
          </li>
          <li>
            <strong>PyLovo</strong>: A grid generation and power network design engine with AI-based
            energy demand estimation for buildings.
          </li>
        </ul>

        <h3 id="data">Data Sources</h3>
        <ul className="wrap-break-words">
          <li>
            <strong>OpenStreetMap (OSM)</strong>: A collaborative project that provides free and
            editable geographic data, forming the backbone of our spatial analyses and building
            classification.
          </li>
          <li>
            <strong>Open-Meteo</strong>: An open-source weather API providing current and forecast
            weather data for real-time environmental conditions display.
          </li>
          <li>
            <strong>
              MERRA-2 (Modern-Era Retrospective Analysis for Research and Applications, Version 2)
            </strong>
            : A NASA dataset providing atmospheric analysis data including solar radiation, wind
            speed, and temperature. It is essential for multiple of our simulations.
          </li>
          <li>
            <strong>3D BAG</strong>: A dataset providing 3D building geometry, heights, and
            construction dates for the Netherlands, used for building enrichment and visualization.
          </li>
          <li>
            <strong>CBS (Centraal Bureau voor de Statistiek)</strong>: Statistics Netherlands,
            providing demographic data at postcode level including population and household counts.
          </li>
          <li>
            <strong>EP-Online</strong>: The Dutch national database for building energy performance
            labels, used for energy efficiency classification.
          </li>
          <li>
            <strong>EUBUCCO</strong>: A European building stock dataset providing building heights,
            types, and estimated floor counts for Germany and other European countries.
          </li>
          <li>
            <strong>MaStR (Marktstammdatenregister)</strong>: The Market Master Data Register, which
            provides comprehensive data on energy production units and market participants in Germany.
          </li>
          <li>
            <strong>National Renewable Energy Laboratory (NREL)</strong>: Providing biopower ambient
            condition data and the System Advisor Model (SAM) for renewable energy simulations.
          </li>
        </ul>
      </div>
    </div>
  );
};

export default Acknowledgements;
