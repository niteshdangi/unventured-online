/*
  TileBounds.ts
  -------------------------------------------------------
  Converts TileKey -> spherical bounding data.

  Responsibilities:
  - Compute cube-face UV -> sphere position
  - Compute tile center in ECEF (unit sphere or scaled)
  - Compute conservative bounding sphere radius
  - Provide data for:
      * Frustum culling
      * Horizon culling
      * Screen-space error (SSE)

  No rendering code.
*/

import { TileKey } from "./TileKey";
import { type Vec3, geodeticToECEF } from "./PlanetMath";

export interface BoundingSphere {
    center: Vec3;
    radius: number;
}

function tileToLon(x: number, z: number): number {
    return (x / Math.pow(2, z)) * 360.0 - 180.0;
}

function tileToLat(y: number, z: number): number {
    const n = Math.PI - 2.0 * Math.PI * y / Math.pow(2, z);
    return (180.0 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function computeTileBoundingSphere(tile: TileKey): BoundingSphere {
    const minLon = tileToLon(tile.x, tile.level) * (Math.PI / 180.0);
    const maxLon = tileToLon(tile.x + 1, tile.level) * (Math.PI / 180.0);
    const minLat = tileToLat(tile.y + 1, tile.level) * (Math.PI / 180.0);
    const maxLat = tileToLat(tile.y, tile.level) * (Math.PI / 180.0);

    // Compute center lat/lon
    const centerLon = (minLon + maxLon) / 2.0;
    const centerLat = (minLat + maxLat) / 2.0;

    // Center in ECEF
    const center = geodeticToECEF({ lat: centerLat, lon: centerLon, height: 0 });

    // Find the furthest corner distance to compute bounding radius
    const corners = [
        { lat: minLat, lon: minLon },
        { lat: minLat, lon: maxLon },
        { lat: maxLat, lon: minLon },
        { lat: maxLat, lon: maxLon }
    ];

    let maxDistSq = 0;
    for (const c of corners) {
        const pt = geodeticToECEF({ lat: c.lat, lon: c.lon, height: 0 });
        const dx = pt.x - center.x;
        const dy = pt.y - center.y;
        const dz = pt.z - center.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > maxDistSq) maxDistSq = distSq;
    }

    // Add 50% extra padding for high terrain displacement like Mt Everest
    return {
        center,
        radius: Math.sqrt(maxDistSq) * 1.5
    };
}

// --------------------------------------------------------
// SCREEN SPACE ERROR (SSE)
// --------------------------------------------------------

export function computeSSE(
    geometricError: number,
    distanceToCamera: number,
    screenHeight: number
): number {
    return (geometricError / distanceToCamera) * screenHeight;
}

// --------------------------------------------------------
// HORIZON CULLING TEST
// --------------------------------------------------------

export function isTileBelowHorizon(
    cameraPos: Vec3,
    tileCenter: Vec3,
    planetRadius: number
): boolean {
    // Normalize vectors
    const camLen = Math.sqrt(cameraPos.x ** 2 + cameraPos.y ** 2 + cameraPos.z ** 2);
    const tileLen = Math.sqrt(tileCenter.x ** 2 + tileCenter.y ** 2 + tileCenter.z ** 2);

    const camNorm = {
        x: cameraPos.x / camLen,
        y: cameraPos.y / camLen,
        z: cameraPos.z / camLen
    };

    const tileNorm = {
        x: tileCenter.x / tileLen,
        y: tileCenter.y / tileLen,
        z: tileCenter.z / tileLen
    };

    const dot = camNorm.x * tileNorm.x +
        camNorm.y * tileNorm.y +
        camNorm.z * tileNorm.z;

    // Horizon angle threshold
    const horizonCos = planetRadius / camLen;

    return dot < horizonCos;
}
