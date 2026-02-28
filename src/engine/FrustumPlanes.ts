/*
  FrustumPlanes.ts
  -------------------------------------------------------
  Production-Grade Frustum Plane Extraction

  Features:
  - Extract 6 normalized frustum planes from combined VP matrix
  - Plane format: ax + by + cz + d = 0
  - Suitable for sphere-frustum intersection
  - GPU-upload ready (Float32Array[24])

  Plane Order (fixed contract):
    0 = Left
    1 = Right
    2 = Bottom
    3 = Top
    4 = Near
    5 = Far

  This layout is frozen for GPU compatibility.
*/

export interface Plane {
    a: number;
    b: number;
    c: number;
    d: number;
}

export class FrustumPlanes {
    private planes: Plane[] = new Array(6);

    constructor() {
        for (let i = 0; i < 6; i++) {
            this.planes[i] = { a: 0, b: 0, c: 0, d: 0 };
        }
    }

    // ------------------------------------------------------
    // EXTRACT FROM VIEW-PROJECTION MATRIX
    // ------------------------------------------------------

    updateFromMatrix(m: Float32Array | Float64Array) {
        // m is column-major 4x4 matrix

        // Left
        this.setPlane(0,
            m[3] + m[0],
            m[7] + m[4],
            m[11] + m[8],
            m[15] + m[12]
        );

        // Right
        this.setPlane(1,
            m[3] - m[0],
            m[7] - m[4],
            m[11] - m[8],
            m[15] - m[12]
        );

        // Bottom
        this.setPlane(2,
            m[3] + m[1],
            m[7] + m[5],
            m[11] + m[9],
            m[15] + m[13]
        );

        // Top
        this.setPlane(3,
            m[3] - m[1],
            m[7] - m[5],
            m[11] - m[9],
            m[15] - m[13]
        );

        // Near (WebGPU / DX depth is 0 to w)
        // Z_clip >= 0 -> m[2]*x + m[6]*y + m[10]*z + m[14]*w >= 0
        this.setPlane(4,
            m[2],
            m[6],
            m[10],
            m[14]
        );

        // Far
        this.setPlane(5,
            m[3] - m[2],
            m[7] - m[6],
            m[11] - m[10],
            m[15] - m[14]
        );
    }

    // ------------------------------------------------------
    // SPHERE TEST
    // ------------------------------------------------------

    intersectsSphere(x: number, y: number, z: number, radius: number): boolean {
        for (let i = 0; i < 6; i++) {
            const p = this.planes[i];
            const distance = p.a * x + p.b * y + p.c * z + p.d;

            if (distance < -radius) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------
    // GPU UPLOAD FORMAT (vec4 * 6)
    // ------------------------------------------------------

    toFloat32Array(): Float32Array {
        const data = new Float32Array(24);

        for (let i = 0; i < 6; i++) {
            const p = this.planes[i];
            const base = i * 4;
            data[base + 0] = p.a;
            data[base + 1] = p.b;
            data[base + 2] = p.c;
            data[base + 3] = p.d;
        }

        return data;
    }

    // ------------------------------------------------------
    // INTERNAL
    // ------------------------------------------------------

    private setPlane(index: number, a: number, b: number, c: number, d: number) {
        const invLen = 1.0 / Math.sqrt(a * a + b * b + c * c);

        this.planes[index].a = a * invLen;
        this.planes[index].b = b * invLen;
        this.planes[index].c = c * invLen;
        this.planes[index].d = d * invLen;
    }
}
