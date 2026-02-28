/*
  GpuLodComputePipeline.ts
  -------------------------------------------------------
  FINAL Production-Grade GPU Visibility + Indirect Builder

  Responsibilities:
  - Frustum culling (6 planes)
  - Sphere visibility test
  - Atomic compaction into indirect buffer
  - No hierarchy refinement (CPU authoritative)
  - Persistent pipeline (no per-frame rebuild)

  GPU Contract (frozen):

  struct Tile {
    center: vec4<f32>;   // xyz local space, w = radius
    face: u32;
    level: u32;
    x: u32;
    y: u32;
  };

  struct DrawCommand {
    indexCount: u32;
    instanceCount: u32;
    firstIndex: u32;
    baseVertex: i32;
    firstInstance: u32;
  };

  FrustumPlanes: array<vec4<f32>, 6>
*/

export interface GpuVisibilityConfig {
    maxTiles: number;
}

export class GpuLodComputePipeline {
    private device: GPUDevice;
    private pipeline!: GPUComputePipeline;
    private bindGroup!: GPUBindGroup;

    private uniformBuffer!: GPUBuffer;

    constructor(device: GPUDevice) {
        this.device = device;
        this.uniformBuffer = this.device.createBuffer({
            size: 16, // Must be 16-byte aligned for uniforms
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.buildPipeline();
    }

    // ------------------------------------------------------
    // INITIALIZE BINDINGS (call when buffers change)
    // ------------------------------------------------------

    initialize(
        tileBuffer: GPUBuffer,
        visibleTilesBuffer: GPUBuffer,
        drawBuffer: GPUBuffer,
        frustumBuffer: GPUBuffer,
        indexCount: number,
        tileCount: number
    ) {
        // Write uniform struct [indexCount, tileCount, pad, pad]
        this.device.queue.writeBuffer(
            this.uniformBuffer,
            0,
            new Uint32Array([indexCount, tileCount, 0, 0])
        );

        if (!this.bindGroup ||
            this.cachedTileBuffer !== tileBuffer ||
            this.cachedDrawBuffer !== drawBuffer ||
            this.cachedVisibleBuffer !== visibleTilesBuffer) {

            this.cachedTileBuffer = tileBuffer;
            this.cachedDrawBuffer = drawBuffer;
            this.cachedVisibleBuffer = visibleTilesBuffer;

            this.bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: tileBuffer } },
                    { binding: 1, resource: { buffer: visibleTilesBuffer } },
                    { binding: 2, resource: { buffer: drawBuffer } },
                    { binding: 3, resource: { buffer: frustumBuffer } },
                    { binding: 4, resource: { buffer: this.uniformBuffer } }
                ]
            });
        }
    }

    private cachedTileBuffer?: GPUBuffer;
    private cachedDrawBuffer?: GPUBuffer;
    private cachedVisibleBuffer?: GPUBuffer;

    dispatch(encoder: GPUCommandEncoder, tileCount: number) {
        if (tileCount === 0) return;

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);

        const workgroupSize = 64;
        const workgroups = Math.ceil(tileCount / workgroupSize);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
    }

    // ------------------------------------------------------
    // PIPELINE BUILD
    // ------------------------------------------------------

    private buildPipeline() {
        const module = this.device.createShaderModule({
            code: this.shaderWGSL()
        });

        this.pipeline = this.device.createComputePipeline({
            layout: "auto",
            compute: {
                module,
                entryPoint: "main"
            }
        });
    }

    // ------------------------------------------------------
    // WGSL
    // ------------------------------------------------------

    private shaderWGSL(): string {
        return `
struct Tile {
  center: vec4<f32>,
  level: u32,
  x: u32,
  y: u32,
  pad: u32
};

@group(0) @binding(0)
var<storage, read> tiles: array<Tile>;

@group(0) @binding(1)
var<storage, read_write> visibleTiles: array<Tile>;

// This binds to the same 20-byte DrawIndexedIndirect struct buffer
// We treat it as an array to perform atomic operations on fields like instanceCount.
@group(0) @binding(2)
var<storage, read_write> drawCommand: array<atomic<u32>>;

@group(0) @binding(3)
var<uniform> frustumPlanes: array<vec4<f32>, 6>;

struct Uniforms {
  indexCount: u32,
  tileCount: u32,
};

@group(0) @binding(4)
var<uniform> uniforms: Uniforms;

fn sphereInFrustum(center: vec3<f32>, radius: f32) -> bool {
  for (var i: u32 = 0u; i < 6u; i = i + 1u) {
    let p = frustumPlanes[i];
    let distance = dot(p.xyz, center) + p.w;
    if (distance < -radius) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;

  if (idx >= uniforms.tileCount) {
    return;
  }

  let tile = tiles[idx];
  let center = tile.center.xyz;
  let radius = tile.center.w;

  if (!sphereInFrustum(center, radius)) {
    return;
  }

  // Increment instanceCount (which is at index 1 of the 5-field struct)
  let drawIndex = atomicAdd(&drawCommand[1], 1u);
  
  // Write the visible tile!
  visibleTiles[drawIndex] = tile;
}
`;
    }
}
