import type { Options } from './schema.js';

/** The subset of the add-on options that calculations and reminders depend on. */
export interface CalcConfig {
  yoyWarningPercent: number;
  gasWindow: { startDay: number; endDay: number };
  electricityWindow: { startDay: number; endDay: number };
  waterIntervalDays: number;
  waterWindowDays: number;
  repeatEveryDays: number;
}

export function calcConfigFromOptions(o: Options): CalcConfig {
  return {
    yoyWarningPercent: o.yoy_warning_percent,
    gasWindow: { startDay: o.gas_window_start_day, endDay: o.gas_window_end_day },
    electricityWindow: { startDay: o.electricity_window_start_day, endDay: o.electricity_window_end_day },
    waterIntervalDays: o.water_interval_days,
    waterWindowDays: o.water_window_days,
    repeatEveryDays: o.repeat_every_days,
  };
}

export const DEFAULT_CALC_CONFIG: CalcConfig = {
  yoyWarningPercent: 15,
  gasWindow: { startDay: 20, endDay: 28 },
  electricityWindow: { startDay: 8, endDay: 11 },
  waterIntervalDays: 60,
  waterWindowDays: 7,
  repeatEveryDays: 2,
};
