// Types for Calliope simulation results

export interface CapacityData {
  technology: string;
  installed_capacity_kw: number;
  utilized_capacity_kw: number;
  capacity_factor: number;
  type?: 'supply' | 'demand';
}



