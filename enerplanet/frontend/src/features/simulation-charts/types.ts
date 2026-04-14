// Types for Calliope simulation results

interface SankeyNode {
  name: string;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface EnergyFlowData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface CapacityData {
  technology: string;
  installed_capacity_kw: number;
  utilized_capacity_kw: number;
  capacity_factor: number;
  type?: 'supply' | 'demand';
}

export interface CostBreakdown {
  category: string;
  value: number;
  color?: string;
}


