import { OFFICIAL_GEOGRAPHIC_UNITS as ORIGINAL_LAUNCH_UNITS } from './official-geography-base';
import { JOUF_GEOGRAPHIC_UNITS } from './official-jouf-geography';

export type { GeographicUnitType, ProjectScopeGroup, OfficialGeographicUnit } from './official-geography-base';
export { OFFICIAL_GEOGRAPHY_SOURCE, OFFICIAL_GEOGRAPHY_SOURCE_URL } from './official-geography-base';

// Add the approved Jouf scope while preserving the original official dataset.
export const OFFICIAL_GEOGRAPHIC_UNITS = [...ORIGINAL_LAUNCH_UNITS, ...JOUF_GEOGRAPHIC_UNITS] as const;
