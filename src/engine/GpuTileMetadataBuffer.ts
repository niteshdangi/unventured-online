/*
  GpuTileMetadataBuffer.ts
  -------------------------------------------------------
  GPU tile metadata packing layer.

  Responsibilities:
  - Convert active TileKey list -> packed GPU buffer
  - Maintain structured layout compatible with WGSL
  - Handle buffer resizing
  - Provide bind group entries

  This is the bridge between CPU quadtree and GPU rendering.
*/

import { TileKey } from "./TileKey";
import { computeTileBoundingSphere } from "./TileBounds";
import { TextureAtlas } from "./TextureAtlas";

// --------------------------------------------------------
// GPU STRUCT LAYOUT (must match WGSL)
// --------------------------------------------------------

/*
struct GpuTile {
  vec4<f32> center;     // xyz = center, w = radius
  u32 face;
  u32 level;
  u32 x;
  u32 y;
};

Alignment rules:
- vec4<f32> = 16 bytes
- each u32 = 4 bytes
Total = 16 + 16 = 32 bytes per tile (aligned)
*/

const BYTES_PER_TILE = 32;

export class GpuTileMetadataBuffer {
    private device: GPUDevice;
    private buffer!: GPUBuffer;
    private capacity: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
        this.allocate(64);
    }

    // ------------------------------------------------------
    // PUBLIC ACCESS
    // ------------------------------------------------------

    getBuffer(): GPUBuffer {
        return this.buffer;
    }

    getCapacity(): number {
        return this.capacity;
    }

    // ------------------------------------------------------
    // UPDATE GPU DATA
    // ------------------------------------------------------

    update(tiles: TileKey[], albedoAtlas?: TextureAtlas, elevationAtlas?: TextureAtlas) {
        const requiredCapacity = tiles.length;

        if (!this.buffer || requiredCapacity > this.capacity) {
            this.allocate(requiredCapacity);
        }

        const arrayBuffer = new ArrayBuffer(requiredCapacity * BYTES_PER_TILE);
        const floatView = new Float32Array(arrayBuffer);
        const uintView = new Uint32Array(arrayBuffer);

        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            const bounds = computeTileBoundingSphere(tile);

            const baseFloat = i * (BYTES_PER_TILE / 4);
            const baseUint = baseFloat;

            // center.xyz + radius
            floatView[baseFloat + 0] = bounds.center.x;
            floatView[baseFloat + 1] = bounds.center.y;
            floatView[baseFloat + 2] = bounds.center.z;
            floatView[baseFloat + 3] = bounds.radius;

            // level, x, y, padding
            uintView[baseUint + 4] = tile.level;
            uintView[baseUint + 5] = tile.x;
            uintView[baseUint + 6] = tile.y;

            const albedoLayer = albedoAtlas?.getLayer(tile) ?? 0;
            const elevationLayer = elevationAtlas?.getLayer(tile) ?? 0;
            const layers = (elevationLayer << 16) | albedoLayer;

            uintView[baseUint + 7] = layers;
        }

        this.device.queue.writeBuffer(
            this.buffer,
            0,
            arrayBuffer
        );
    }

    // ------------------------------------------------------
    // INTERNAL
    // ------------------------------------------------------

    private allocate(tileCount: number) {
        this.capacity = Math.max(tileCount, 64);

        this.buffer = this.device.createBuffer({
            size: this.capacity * BYTES_PER_TILE,
            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST,
            mappedAtCreation: false
        });
    }
}
