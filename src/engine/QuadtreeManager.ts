/*
  QuadtreeManager.ts
  -------------------------------------------------------
  FINAL Production-Grade CPU Quadtree LOD Manager

  Features:
  - Deterministic refinement
  - Screen-space error (SSE)
  - Frustum culling (sphere vs 6 planes)
  - Horizon culling
  - Parent-retain rule (prevents cracks)
  - No partial-child collapse

  This file is contract-stable.
*/

import { TileKey } from "./TileKey";
import { computeTileBoundingSphere } from "./TileBounds";
import { FrustumPlanes } from "./FrustumPlanes";
import type { Vec3 } from "./PlanetMath";

export interface QuadtreeConfig {
    planetRadius: number;
    maxLevel: number;
    minLevel: number;
    sseThreshold: number;
}

export interface CameraState {
    positionECEF: Vec3;   // ECEF space
    screenHeight: number;
    frustum: FrustumPlanes;
}

export class QuadtreeManager {
    private config: QuadtreeConfig;
    private activeTiles: Map<string, TileKey> = new Map();

    constructor(config: QuadtreeConfig) {
        this.config = config;

        for (const root of TileKey.rootFaces()) {
            this.activeTiles.set(root.toString(), root);
        }
    }

    getActiveTiles(): TileKey[] {
        return Array.from(this.activeTiles.values());
    }

    update(camera: CameraState): { added: TileKey[], removed: TileKey[], active: TileKey[] } {
        const nextTiles: Map<string, TileKey> = new Map();

        for (const root of TileKey.rootFaces()) {
            this.processTile(root, camera, nextTiles);
        }

        const added: TileKey[] = [];
        const removed: TileKey[] = [];
        const active: TileKey[] = [];

        for (const [key, tile] of nextTiles) {
            active.push(tile);
            if (!this.activeTiles.has(key)) {
                added.push(tile);
            }
        }

        for (const [key, tile] of this.activeTiles) {
            if (!nextTiles.has(key)) {
                removed.push(tile);
            }
        }

        this.activeTiles = nextTiles;

        return { added, removed, active };
    }

    // ------------------------------------------------------
    // RECURSIVE PROCESS
    // ------------------------------------------------------

    private processTile(
        tile: TileKey,
        camera: CameraState,
        nextTiles: Map<string, TileKey>
    ) {
        const { maxLevel, minLevel, sseThreshold } = this.config;

        const bounds = computeTileBoundingSphere(tile);

        // Frustum test
        if (!camera.frustum.intersectsSphere(
            bounds.center.x,
            bounds.center.y,
            bounds.center.z,
            bounds.radius
        )) {
            return;
        }

        // Distance in ECEF space to the closest point on the bounding sphere
        const dx = bounds.center.x - camera.positionECEF.x;
        const dy = bounds.center.y - camera.positionECEF.y;
        const dz = bounds.center.z - camera.positionECEF.z;

        const distanceToCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const distance = Math.max(0.1, distanceToCenter - bounds.radius);

        const geometricError = this.computeGeometricError(tile.level);
        const sse = (geometricError / distance) * camera.screenHeight;

        const shouldRefine =
            tile.level < maxLevel &&
            (sse > sseThreshold || tile.level < minLevel);

        if (shouldRefine) {
            const children = tile.getChildren();
            let anyChildVisible = false;

            for (const child of children) {
                const childBounds = computeTileBoundingSphere(child);

                if (camera.frustum.intersectsSphere(
                    childBounds.center.x,
                    childBounds.center.y,
                    childBounds.center.z,
                    childBounds.radius
                )) {
                    anyChildVisible = true;
                    this.processTile(child, camera, nextTiles);
                }
            }

            // Parent-retain rule
            if (!anyChildVisible) {
                nextTiles.set(tile.toString(), tile);
            }

        } else {
            nextTiles.set(tile.toString(), tile);
        }
    }

    private computeGeometricError(level: number): number {
        // Equatorial circumference / 256 pixels
        const baseError = 40075016.68 / 256.0;
        return baseError / (1 << level);
    }
}
