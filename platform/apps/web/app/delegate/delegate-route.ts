export interface RouteStop { id: string; latitude: number; longitude: number }
export interface RoutePoint { latitude: number; longitude: number }

export function haversineKm(a: RoutePoint, b: RoutePoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude); const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function orderStopsNearestNeighbour<T extends RouteStop>(stops: T[], start?: RoutePoint): T[] {
  if (stops.length < 2) return [...stops];
  const remaining = [...stops].sort((a, b) => a.id.localeCompare(b.id));
  const ordered: T[] = [];
  let cursor = start ?? remaining[0];
  while (remaining.length) {
    remaining.sort((a, b) => haversineKm(cursor, a) - haversineKm(cursor, b) || a.id.localeCompare(b.id));
    const next = remaining.shift()!;
    ordered.push(next); cursor = next;
  }
  return ordered;
}

export function buildGoogleMapsSegments<T extends RouteStop>(ordered: T[], start?: RoutePoint, maxStops = 10) {
  if (!ordered.length) return [];
  const segments: string[] = [];
  let origin = start;
  for (let index = 0; index < ordered.length;) {
    const room = origin ? maxStops - 1 : maxStops;
    const chunk = ordered.slice(index, index + Math.max(1, room));
    const first = origin ?? chunk[0];
    const destination = chunk[chunk.length - 1];
    const waypoints = (origin ? chunk.slice(0, -1) : chunk.slice(1, -1));
    const params = new URLSearchParams({ api: '1', origin: coordinate(first), destination: coordinate(destination), travelmode: 'driving' });
    if (waypoints.length) params.set('waypoints', waypoints.map(coordinate).join('|'));
    segments.push(`https://www.google.com/maps/dir/?${params.toString()}`);
    origin = destination; index += chunk.length;
  }
  return segments;
}

function coordinate(point: RoutePoint) { return `${point.latitude},${point.longitude}`; }
