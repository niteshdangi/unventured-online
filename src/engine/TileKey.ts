/*
  TileKey.ts
  -------------------------------------------------------
  Deterministic cube-sphere quadtree indexing system
  for full-globe planetary LOD.

  Responsibilities:
  - Unique tile identification (face, level, x, y)
  - Parent/child relationships
  - Morton (Z-order) encoding (optional GPU packing)
  - Stable string and numeric keys
  - MMO server partition compatibility

  This file contains ZERO rendering logic.
*/

// --------------------------------------------------------
// BASIC TILE IDENTIFIER
// --------------------------------------------------------

export interface TileKeyData {
    level: number;  // LOD level (0 = root)
    x: number;      // tile x at level
    y: number;      // tile y at level
}

export class TileKey implements TileKeyData {
    public readonly face: number; // 0-5
    public readonly level: number;
    public readonly x: number;
    public readonly y: number;

    constructor(face: number, level: number, x: number, y: number) {
        if (face < 0 || face > 5) throw new Error("Invalid face");
        if (level < 0) throw new Error("Invalid LOD level");
        if (x < 0 || y < 0) throw new Error("Invalid tile coordinates");

        this.face = face;
        this.level = level;
        this.x = x;
        this.y = y;
    }

    // ------------------------------------------------------
    // HIERARCHY
    // ------------------------------------------------------

    getParent(): TileKey | null {
        if (this.level === 0) return null;

        return new TileKey(
            this.face,
            this.level - 1,
            this.x >> 1,
            this.y >> 1
        );
    }

    getChildren(): TileKey[] {
        const nextLevel = this.level + 1;
        const nx = this.x * 2;
        const ny = this.y * 2;

        return [
            new TileKey(this.face, nextLevel, nx, ny),
            new TileKey(this.face, nextLevel, nx + 1, ny),
            new TileKey(this.face, nextLevel, nx, ny + 1),
            new TileKey(this.face, nextLevel, nx + 1, ny + 1)
        ];
    }

    // ------------------------------------------------------
    // ROOT TILES
    // ------------------------------------------------------

    static rootFaces(): TileKey[] {
        const roots: TileKey[] = [];
        for (let face = 0; face < 6; face++) {
            roots.push(new TileKey(face, 0, 0, 0));
        }
        return roots;
    }

    // ------------------------------------------------------
    // UNIQUE IDENTIFIERS
    // ------------------------------------------------------

    equals(other: TileKey): boolean {
        return this.face === other.face && this.level === other.level && this.x === other.x && this.y === other.y;
    }

    toString(): string {
        return `${this.face}/${this.level}/${this.x}/${this.y}`;
    }

    toNumericKey(): bigint {
        /*
          3 bits  -> face (0–5)
          6 bits  -> level (supports up to level 63)
          27 bits -> x
          27 bits -> y
    
          Total: 63 bits (fits inside signed 64-bit bigint)
        */

        const facePart = BigInt(this.face) << 60n;
        const levelPart = BigInt(this.level) << 54n;
        const xPart = BigInt(this.x) << 27n;
        const yPart = BigInt(this.y);

        return facePart | levelPart | xPart | yPart;
    }

    // ------------------------------------------------------
    // MORTON CODE (Z-ORDER) FOR GPU PACKING
    // ------------------------------------------------------

    mortonCode(): number {
        return interleaveBits(this.x, this.y);
    }

    // ------------------------------------------------------
    // TILE DIMENSION AT LEVEL
    // ------------------------------------------------------

    static tilesPerFace(level: number): number {
        return 1 << level;
    }

    static tileAngularSizeRadians(level: number): number {
        // Each cube face spans 90 degrees
        const tiles = 1 << level;
        return (Math.PI / 2) / tiles;
    }

    // ------------------------------------------------------
    // BOUNDS (UV SPACE ON FACE)
    // ------------------------------------------------------

    getUVBounds(): { uMin: number; uMax: number; vMin: number; vMax: number } {
        const tiles = 1 << this.level;
        const size = 1 / tiles;

        const uMin = this.x * size;
        const vMin = this.y * size;

        return {
            uMin,
            uMax: uMin + size,
            vMin,
            vMax: vMin + size
        };
    }
}

// --------------------------------------------------------
// BIT INTERLEAVING (MORTON)
// --------------------------------------------------------

function interleaveBits(x: number, y: number): number {
    x &= 0xffff;
    y &= 0xffff;

    x = (x | (x << 8)) & 0x00ff00ff;
    x = (x | (x << 4)) & 0x0f0f0f0f;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;

    y = (y | (y << 8)) & 0x00ff00ff;
    y = (y | (y << 4)) & 0x0f0f0f0f;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;

    return x | (y << 1);
}
