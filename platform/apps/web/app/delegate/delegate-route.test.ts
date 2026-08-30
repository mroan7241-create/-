import { buildGoogleMapsSegments, orderStopsNearestNeighbour } from './delegate-route';

describe('delegate route', () => {
  it('orders deterministically by nearest neighbour', () => {
    const stops = [{ id: 'c', latitude: 24.9, longitude: 46.7 }, { id: 'a', latitude: 24.71, longitude: 46.7 }, { id: 'b', latitude: 24.72, longitude: 46.7 }];
    expect(orderStopsNearestNeighbour(stops, { latitude: 24.7, longitude: 46.7 }).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
  it('splits long directions without dropping a stop', () => {
    const stops = Array.from({ length: 23 }, (_, index) => ({ id: String(index), latitude: 24 + index / 100, longitude: 46 }));
    const segments = buildGoogleMapsSegments(stops, { latitude: 23.9, longitude: 46 }, 10);
    expect(segments).toHaveLength(3);
    expect(segments.every((url) => url.startsWith('https://www.google.com/maps/dir/?'))).toBe(true);
  });
});
