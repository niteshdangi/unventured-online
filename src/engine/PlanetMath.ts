/*
  PlanetMath.ts
  -------------------------------------------------------
  Production-grade double precision planetary math layer
  for 1:1 Earth scale simulation.

  Includes:
  - WGS84 constants
  - Geodetic <-> ECEF conversions
  - ECEF <-> ENU local frame transforms
  - Floating origin anchor support
  - Deterministic, server-safe math

  All math is double precision (JavaScript number).
*/

// --------------------------------------------------------
// WGS84 CONSTANTS
// --------------------------------------------------------

export const WGS84: Record<string, number> = {
    a: 6378137.0,                     // semi-major axis (meters)
    f: 1.0 / 298.257223563,           // flattening
};

WGS84["b"] = WGS84.a * (1 - WGS84.f);               // semi-minor axis
WGS84["e2"] = 2 * WGS84.f - WGS84.f * WGS84.f;      // eccentricity^2

// --------------------------------------------------------
// BASIC TYPES
// --------------------------------------------------------

export interface Geodetic {
    lat: number;    // radians
    lon: number;    // radians
    height: number; // meters
}

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

// --------------------------------------------------------
// GEODETIC -> ECEF
// --------------------------------------------------------

export function geodeticToECEF(g: Geodetic): Vec3 {
    const { lat, lon, height } = g;

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    const N = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);

    const x = (N + height) * cosLat * cosLon;
    const y = (N + height) * cosLat * sinLon;
    const z = (N * (1 - WGS84.e2) + height) * sinLat;

    return { x, y, z };
}

// --------------------------------------------------------
// ECEF -> GEODETIC (ITERATIVE, STABLE)
// --------------------------------------------------------

export function ecefToGeodetic(p: Vec3): Geodetic {
    const { x, y, z } = p;

    const a = WGS84.a;
    const e2 = WGS84.e2;

    const lon = Math.atan2(y, x);
    const pxy = Math.sqrt(x * x + y * y);

    let lat = Math.atan2(z, pxy * (1 - e2));
    let prevLat = 0;

    let N = 0;
    let height = 0;

    while (Math.abs(lat - prevLat) > 1e-12) {
        prevLat = lat;
        const sinLat = Math.sin(lat);
        N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        height = pxy / Math.cos(lat) - N;
        lat = Math.atan2(z, pxy * (1 - e2 * (N / (N + height))));
    }

    return { lat, lon, height };
}

// --------------------------------------------------------
// ECEF -> ENU LOCAL FRAME
// --------------------------------------------------------

export function ecefToENU(
    point: Vec3,
    anchorGeodetic: Geodetic
): Vec3 {
    const anchorECEF = geodeticToECEF(anchorGeodetic);

    const dx = point.x - anchorECEF.x;
    const dy = point.y - anchorECEF.y;
    const dz = point.z - anchorECEF.z;

    const sinLat = Math.sin(anchorGeodetic.lat);
    const cosLat = Math.cos(anchorGeodetic.lat);
    const sinLon = Math.sin(anchorGeodetic.lon);
    const cosLon = Math.cos(anchorGeodetic.lon);

    const east = -sinLon * dx + cosLon * dy;
    const north = -sinLat * cosLon * dx
        - sinLat * sinLon * dy
        + cosLat * dz;
    const up = cosLat * cosLon * dx
        + cosLat * sinLon * dy
        + sinLat * dz;

    return { x: east, y: north, z: up };
}

// --------------------------------------------------------
// ENU -> ECEF
// --------------------------------------------------------

export function enuToECEF(
    enu: Vec3,
    anchorGeodetic: Geodetic
): Vec3 {
    const anchorECEF = geodeticToECEF(anchorGeodetic);

    const sinLat = Math.sin(anchorGeodetic.lat);
    const cosLat = Math.cos(anchorGeodetic.lat);
    const sinLon = Math.sin(anchorGeodetic.lon);
    const cosLon = Math.cos(anchorGeodetic.lon);

    const dx =
        -sinLon * enu.x
        - sinLat * cosLon * enu.y
        + cosLat * cosLon * enu.z;

    const dy =
        cosLon * enu.x
        - sinLat * sinLon * enu.y
        + cosLat * sinLon * enu.z;

    const dz =
        cosLat * enu.y
        + sinLat * enu.z;

    return {
        x: anchorECEF.x + dx,
        y: anchorECEF.y + dy,
        z: anchorECEF.z + dz
    };
}

// --------------------------------------------------------
// FLOATING ORIGIN SYSTEM
// --------------------------------------------------------

export class FloatingOrigin {
    private anchor: Geodetic;

    constructor(initialAnchor: Geodetic) {
        this.anchor = { ...initialAnchor };
    }

    getAnchor(): Geodetic {
        return { ...this.anchor };
    }

    setAnchor(newAnchor: Geodetic) {
        this.anchor = { ...newAnchor };
    }

    // Convert world geodetic position to local ENU
    toLocal(g: Geodetic): Vec3 {
        const ecef = geodeticToECEF(g);
        return ecefToENU(ecef, this.anchor);
    }

    // Convert local ENU back to geodetic
    toGeodetic(local: Vec3): Geodetic {
        const ecef = enuToECEF(local, this.anchor);
        return ecefToGeodetic(ecef);
    }

    // Re-anchor if player drifts too far from origin
    recenterIfNeeded(playerLocal: Vec3, thresholdMeters: number) {
        const dist = Math.sqrt(
            playerLocal.x * playerLocal.x +
            playerLocal.y * playerLocal.y +
            playerLocal.z * playerLocal.z
        );

        if (dist > thresholdMeters) {
            const newGeodetic = this.toGeodetic(playerLocal);
            this.setAnchor(newGeodetic);
        }
    }
}

// --------------------------------------------------------
// UTILITY HELPERS
// --------------------------------------------------------

export function degToRad(deg: number): number {
    return deg * Math.PI / 180;
}

export function radToDeg(rad: number): number {
    return rad * 180 / Math.PI;
}
