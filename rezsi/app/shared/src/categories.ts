// Fixed utility categories. Adding a category means shipping a new add-on version.

export const METER_IDS = ['gas', 'electricity', 'water'] as const;
export type MeterId = (typeof METER_IDS)[number];

export const BILL_IDS = ['gas', 'electricity', 'water', 'telecom', 'waste'] as const;
export type BillId = (typeof BILL_IDS)[number];

export interface MeterDef {
  label: string;
  unit: string;
  /** Whether a (possibly different) reading is reported to the provider. */
  reported: boolean;
  /** Light fill used in tables and xlsx, taken from the original sheet. */
  fill: string;
  /** Saturated color for charts and accents. */
  color: string;
}

export const METERS: Record<MeterId, MeterDef> = {
  gas: { label: 'Gáz', unit: 'm³', reported: true, fill: '#EFEFEF', color: '#7A7F87' },
  electricity: { label: 'Villany', unit: 'kWh', reported: false, fill: '#FFF2CC', color: '#E0A800' },
  water: { label: 'Víz', unit: 'm³', reported: false, fill: '#D0E0E3', color: '#3D85C6' },
};

export interface BillDef {
  label: string;
  fill: string;
  color: string;
}

export const BILLS: Record<BillId, BillDef> = {
  gas: { label: 'Gáz', fill: METERS.gas.fill, color: METERS.gas.color },
  electricity: { label: 'Villany', fill: METERS.electricity.fill, color: METERS.electricity.color },
  water: { label: 'Víz', fill: METERS.water.fill, color: METERS.water.color },
  telecom: { label: 'Telekom', fill: '#FCE5CD', color: '#E69138' },
  waste: { label: 'Szemétszállítás', fill: '#F4CCCC', color: '#CC4125' },
};

export const TOTAL_FILL = '#FFFF00';

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type Month = (typeof MONTHS)[number];

export const MONTH_NAMES_HU = [
  'január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december',
] as const;

export function monthName(month: number, capitalized = true): string {
  const name = MONTH_NAMES_HU[month - 1] ?? String(month);
  return capitalized ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
