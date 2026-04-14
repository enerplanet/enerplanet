# EnerPlanET Frontend

A modern React-based energy simulation platform for visualizing and analyzing energy scenarios in geographic regions.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

````bash
# Install dependencies
npm install

### Development

```bash
# Start development server
npm run dev

# Runs on http://localhost:3000
````

### Building

```bash
# Build for production
npm run build

# Lint code
npm run lint
```

## Overview

EnerPlanET is a web application that allows users to:

- Create and manage energy scenarios for different geographic regions
- Visualize energy data on interactive maps using MapLibre GL
- Configure energy technologies and parameters
- Analyze simulation results and generate reports
- Collaborate through shared workspaces

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
- **Routing**: React Router
- **Maps**: MapLibre GL
- **Forms**: Custom form system based on @spatialhub/forms (local dependency in `../../libs/forms/`)
- **UI Components**: Custom UI library (@spatialhub/ui) (local dependency in `../../libs/ui/`)

## Project Structure

```
frontend/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── app-layout/      # Main application layout
│   │   ├── group/           # Group management components
│   │   ├── map-controls/    # Map interaction controls
│   │   ├── shared/          # Shared components
│   │   ├── table/           # Table components
│   │   ├── ui/              # UI primitives and widgets
│   │   └── workspace/       # Workspace management
│   ├── features/            # Feature modules
│   │   ├── admin-dashboard/ # Admin panel features
│   │   ├── assessment-viewer/ # Assessment visualization
│   │   ├── authentication/   # Login/register flows
│   │   ├── configurator/     # Energy scenario configuration
│   │   ├── guided-tour/      # User onboarding
│   │   ├── locations/        # Location management
│   │   ├── model-dashboard/  # Energy risk dashboard
│   │   ├── model-results/    # Simulation results viewer
│   │   └── technologies/     # Technology information
│   ├── configuration/       # Form configurations and settings
│   ├── constants/           # Application constants
│   ├── providers/           # React providers
│   ├── utils/               # Utility functions
│   └── App.tsx              # Main application component
├── public/
│   ├── images/              # Static assets
│   └── initial-data/        # Initial data for technologies
├── scripts/                 # Build and data generation scripts
└── package.json
```

## Key Features

### User Management

- User registration and authentication
- Role-based access control (Very Low, Intermediate, Manager, Expert)
- Email verification
- Profile management

### Energy Scenario Configuration

- Interactive map-based region selection
- Building configuration and placement
- Energy technology selection (Solar, Wind, Biomass, Geothermal, etc.)
- Power flow analysis and visualization
- Grid assignments and load calculations

### Admin Dashboard

- User management
- Model management
- Feedback management
- Web services management
- Pylovo data management

### Assessment Viewer

- Visualize energy assessments
- Compare different scenarios
- Export simulation results

## Technologies Supported

The platform supports various energy technologies:

- Solar panels
- Wind turbines
- Biomass plants
- Geothermal systems
- Industrial energy systems
- Residential energy systems

## Data

- Initial technology data is loaded from JSON files in `public/initial-data/techs/`
- Technology documentation is available in `public/docs/technology-reference-guide.pdf`
- Building configuration uses detailed form parameters

## Configuration

The application uses configuration files in `src/configuration/`:

- `app.ts` - Application settings
- `auth.ts` - Authentication configuration
- `formConfigurations.ts` - Form definitions for user management and other features

## Custom Plugin Integration

### @spatialhub/forms

The custom form system is integrated through:

1. **Installation**: The forms library is installed as a local dependency (`../../libs/forms/`)
2. **Import paths**: Forms components are imported using the alias `@/spatialhub/forms`
3. **Configuration**: Form configurations are defined in `src/configuration/formConfigurations.ts`
4. **Usage**: Forms are used throughout the application for user management, building configuration, and other interactive elements

Example usage:

```typescript
import { FormSection } from "@spatialhub/forms";
// Define form sections with fields, validation, and icons
```

### @spatialhub/ui

The custom UI library provides reusable components and utilities:

1. **Installation**: The UI library is installed as a local dependency (`../../libs/ui/`)
2. **Import paths**: UI components are imported using the alias `@/spatialhub/ui`
3. **Components**: Includes tooltip providers, layout providers, and various UI primitives
4. **Styling**: Tailwind CSS is configured to include both frontend and library components

Example usage:

```typescript
import { TooltipProvider } from "@spatialhub/ui";
// Use tooltip components throughout the application
```

### Integration in Vite

Both libraries are configured in `vite.config.ts`:

- **Path aliases**: Resolved to their source directories in `resolve.alias`
- **Deduping**: React and React DOM are deduped for optimal bundle size
- **Content paths**: Tailwind CSS includes both frontend and library source files

## API Integration

The frontend communicates with the backend through:

- `/api` proxy routes (proxied to `http://localhost:8000` in development)
- Authentication via @spatialhub/auth (local dependency in `../../libs/auth/`)
- Forms via @spatialhub/forms (local dependency in `../../libs/forms/`)
- UI components via @spatialhub/ui (local dependency in `../../libs/ui/`)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

_EnerPlanET - Energy Simulation Platform_
