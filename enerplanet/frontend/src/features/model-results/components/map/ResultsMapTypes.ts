
export interface BusStatusData {
  bus: string;
  location: string;
  avgVoltage: number;
  avgPower: number;
  status: 'normal' | 'warning' | 'critical';
}


interface BuildingTechnology {
  tech: string;
  capacity: number;
  name?: string;
}


export interface BuildingResultData {
  buildingId: string;
  address?: string;
  technologies: BuildingTechnology[];
  totalDemand: number;
  totalProduction: number;
  matchedLocationId?: string;
  fClass?: string;
  fClasses?: string[];
  area?: number;
  height?: number;
  levels?: number;
  roofArea?: number;
  yearBuilt?: number;
  osmId?: string;
  techConfig?: Record<string, unknown>;
  // Energy demand
  yearlyDemandKwh?: number;
  peakLoadKw?: number;
  // Building enrichment (3D BAG for NL, EUBUCCO for DE/AT/others)
  bagId?: string;
  constructionYear?: number;
  floors3dbag?: number;
  heightMax?: number;
  heightMedian?: number;
  heightGround?: number;
  // EP-Online enrichment
  energyLabel?: string;
  energyIndex?: number;
  // CBS enrichment
  cbsPopulation?: number;
  cbsHouseholds?: number;
  cbsAvgHouseholdSize?: number;
}
