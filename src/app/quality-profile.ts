export type QualityLevel = 'low' | 'medium' | 'high';

export type QualityProfile = {
  label: string;
  renderRadius: number;
  fogStart: number;
  fogEnd: number;
  shadowQuality: 'off' | 'low';
  resolutionScale: number;
  waterQuality: number;
  vegetationDensity: number;
};

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    label: 'Low',
    renderRadius: 1,
    fogStart: 26,
    fogEnd: 54,
    shadowQuality: 'off',
    resolutionScale: 0.72,
    waterQuality: 0.55,
    vegetationDensity: 0.62,
  },
  medium: {
    label: 'Medium',
    renderRadius: 2,
    fogStart: 48,
    fogEnd: 92,
    shadowQuality: 'off',
    resolutionScale: 0.88,
    waterQuality: 0.78,
    vegetationDensity: 0.8,
  },
  high: {
    label: 'High',
    renderRadius: 3,
    fogStart: 72,
    fogEnd: 132,
    shadowQuality: 'low',
    resolutionScale: 1,
    waterQuality: 1,
    vegetationDensity: 1,
  },
};
