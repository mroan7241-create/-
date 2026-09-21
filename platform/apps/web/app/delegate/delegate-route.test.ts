import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { buildGoogleMapsSegments, orderStopsNearestNeighbour } from './delegate-route.ts';

test('delegate route orders deterministically by nearest neighbour', () => {
    const stops = [{ id: 'c', latitude: 24.9, longitude: 46.7 }, { id: 'a', latitude: 24.71, longitude: 46.7 }, { id: 'b', latitude: 24.72, longitude: 46.7 }];
    assert.deepEqual(orderStopsNearestNeighbour(stops, { latitude: 24.7, longitude: 46.7 }).map((item) => item.id), ['a', 'b', 'c']);
});

test('delegate route splits long directions without dropping a stop', () => {
    const stops = Array.from({ length: 23 }, (_, index) => ({ id: String(index), latitude: 24 + index / 100, longitude: 46 }));
    const segments = buildGoogleMapsSegments(stops, { latitude: 23.9, longitude: 46 }, 10);
    assert.equal(segments.length, 3);
    assert.equal(segments.every((url) => url.startsWith('https://www.google.com/maps/dir/?')), true);
});
