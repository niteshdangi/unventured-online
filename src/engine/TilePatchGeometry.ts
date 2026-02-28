/*
  TilePatchGeometry.ts
  -------------------------------------------------------
  FINAL Production-Grade Static Tile Patch Geometry

  Features:
  - Single immutable vertex buffer
  - Single immutable index buffer
  - Core grid + fully baked skirts
  - No dynamic mutation
  - GPU-friendly layout
  - Deterministic topology

  Vertex Layout:
    location(0) -> vec2<f32> (uv in tile space 0..1)

  Skirts:
    - Separate skirt vertex ring
    - Skirt vertices duplicated from border
    - Shader offsets them downward along normal

  This file is now structurally correct and stable.
*/

export interface TilePatchGeometryConfig {
    resolution: number;      // e.g. 33, 65, 129
    enableSkirts: boolean;
}

export class TilePatchGeometry {
    private device: GPUDevice;
    private resolution: number;
    private enableSkirts: boolean;

    private vertexBuffer!: GPUBuffer;
    private indexBuffer!: GPUBuffer;

    private indexCount: number = 0;

    constructor(device: GPUDevice, config: TilePatchGeometryConfig) {
        if (config.resolution < 2) {
            throw new Error("Resolution must be >= 2");
        }

        this.device = device;
        this.resolution = config.resolution;
        this.enableSkirts = config.enableSkirts;

        this.build();
    }

    // ------------------------------------------------------
    // PUBLIC
    // ------------------------------------------------------

    getVertexBuffer(): GPUBuffer {
        return this.vertexBuffer;
    }

    getIndexBuffer(): GPUBuffer {
        return this.indexBuffer;
    }

    getIndexCount(): number {
        return this.indexCount;
    }

    // ------------------------------------------------------
    // BUILD
    // ------------------------------------------------------

    private build() {
        const { vertices, indices } = this.generateGeometry();

        this.vertexBuffer = this.device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });

        new Float32Array(this.vertexBuffer.getMappedRange()).set(vertices);
        this.vertexBuffer.unmap();

        this.indexBuffer = this.device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });

        new Uint32Array(this.indexBuffer.getMappedRange()).set(indices);
        this.indexBuffer.unmap();

        this.indexCount = indices.length;
    }

    // ------------------------------------------------------
    // GEOMETRY GENERATION
    // ------------------------------------------------------

    private generateGeometry(): {
        vertices: Float32Array;
        indices: Uint32Array;
    } {
        const res = this.resolution;

        const verts: number[] = [];
        const inds: number[] = [];

        // ---------------- Core Grid ----------------
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                verts.push(x / (res - 1), y / (res - 1));
            }
        }

        for (let y = 0; y < res - 1; y++) {
            for (let x = 0; x < res - 1; x++) {
                const i0 = y * res + x;
                const i1 = i0 + 1;
                const i2 = i0 + res;
                const i3 = i2 + 1;

                inds.push(i0, i2, i1);
                inds.push(i1, i2, i3);
            }
        }

        // ---------------- Skirts ----------------
        if (this.enableSkirts) {
            const baseVertexCount = verts.length / 2;

            const borderIndices = this.getBorderVertexIndices(res);
            const skirtStart = baseVertexCount;

            // Duplicate border vertices
            for (const i of borderIndices) {
                const u = verts[i * 2];
                const v = verts[i * 2 + 1];
                verts.push(u, v);
            }

            // Build skirt triangles
            for (let i = 0; i < borderIndices.length - 1; i++) {
                const top0 = borderIndices[i];
                const top1 = borderIndices[i + 1];
                const bot0 = skirtStart + i;
                const bot1 = skirtStart + i + 1;

                inds.push(top0, bot0, top1);
                inds.push(top1, bot0, bot1);
            }
        }

        return {
            vertices: new Float32Array(verts),
            indices: new Uint32Array(inds)
        };
    }

    // ------------------------------------------------------
    // BORDER INDEX ORDER (clockwise loop)
    // ------------------------------------------------------

    private getBorderVertexIndices(res: number): number[] {
        const result: number[] = [];

        // Top row
        for (let x = 0; x < res; x++) {
            result.push(x);
        }

        // Right column
        for (let y = 1; y < res; y++) {
            result.push(y * res + (res - 1));
        }

        // Bottom row
        for (let x = res - 2; x >= 0; x--) {
            result.push((res - 1) * res + x);
        }

        // Left column
        for (let y = res - 2; y > 0; y--) {
            result.push(y * res);
        }

        // Close loop
        result.push(0);

        return result;
    }
}
