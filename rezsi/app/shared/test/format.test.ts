import { describe, expect, it } from 'vitest';
import { formatDate, formatDateRange, formatHuf, formatNumber, formatPercent, parseDateInput, parseNumberInput } from '../src/index.js';

const S = '\u00A0';

describe('format', () => {
  it('formats Hungarian numbers', () => {
    expect(formatNumber(1234567)).toBe(`1${S}234${S}567`);
    expect(formatNumber(1234.5)).toBe(`1${S}234,5`);
    expect(formatNumber(-0.004)).toBe('0');
    expect(formatNumber(-12.345)).toBe('-12,35');
    expect(formatHuf(1234567.4)).toBe(`1${S}234${S}567${S}Ft`);
    expect(formatHuf(undefined)).toBe('–');
    expect(formatPercent(15.04)).toBe(`+15${S}%`);
    expect(formatPercent(-3.25)).toBe(`-3,3${S}%`);
  });

  it('formats dates', () => {
    expect(formatDate('2026-10-08')).toBe('2026.10.08.');
    expect(formatDateRange('2026-10-20', '2026-10-28')).toBe('2026.10.20.–2026.10.28.');
  });

  it('parses typed dates in year.month.day order', () => {
    expect(parseDateInput('2026.10.08.')).toBe('2026-10-08');
    expect(parseDateInput('2026. 10. 8.')).toBe('2026-10-08');
    expect(parseDateInput('2026-10-08')).toBe('2026-10-08');
    expect(parseDateInput('20261008')).toBe('2026-10-08');
    expect(parseDateInput('  ')).toBeUndefined();
    expect(parseDateInput('2026.02.30.')).toBeNull();
    expect(parseDateInput('10.08.2026')).toBeNull();
  });

  it('parses user input', () => {
    expect(parseNumberInput('1 234,5')).toBe(1234.5);
    expect(parseNumberInput('1234.5')).toBe(1234.5);
    expect(parseNumberInput('1.234,5')).toBe(1234.5);
    expect(parseNumberInput('12 345 Ft')).toBe(12345);
    expect(parseNumberInput('')).toBeUndefined();
    expect(parseNumberInput('abc')).toBeNaN();
  });
});
