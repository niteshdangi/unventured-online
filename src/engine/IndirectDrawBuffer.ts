/*
  IndirectDrawBuffer.ts
  -------------------------------------------------------
  GPU multi-draw indirect command buffer manager.

  Responsibilities:
  - Maintain GPU indirect draw buffer
  - Maintain visible tile count buffer
  - Reset / clear per-frame
  - Provide bindable GPU resources

  Designed for GPU-driven rendering pipeline.

  WGSL struct layout must match:

  struct DrawIndexedIndirect {
    indexCount: u32;
    instanceCount: u32;
    firstIndex: u32;
    baseVertex: i32;
    firstInstance: u32;
  };

  20 bytes per command.
*/

// --------------------------------------------------------
// CONSTANTS
// --------------------------------------------------------

const BYTES_PER_DRAW = 20;
const BYTES_PER_TILE = 32;

export class IndirectDrawBuffer {
    private device: GPUDevice;

    private drawBuffer!: GPUBuffer;
    private visibleTilesBuffer!: GPUBuffer;

    private capacity: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    getDrawBuffer(): GPUBuffer {
        return this.drawBuffer;
    }

    getVisibleTilesBuffer(): GPUBuffer {
        return this.visibleTilesBuffer;
    }

    getCapacity(): number {
        return this.capacity;
    }

    ensureCapacity(commandCount: number) {
        if (!this.drawBuffer || commandCount > this.capacity) {
            this.allocate(Math.max(commandCount, 64));
        }
    }

    private allocate(tileCapacity: number) {
        this.capacity = tileCapacity;

        // SINGLE 20-byte indirect struct buffer
        this.drawBuffer = this.device.createBuffer({
            size: BYTES_PER_DRAW,
            usage:
                GPUBufferUsage.INDIRECT |
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST,
            mappedAtCreation: false
        });

        // Contiguous buffer of visible tiles for the vertex shader
        this.visibleTilesBuffer = this.device.createBuffer({
            size: this.capacity * BYTES_PER_TILE,
            usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST,
            mappedAtCreation: false
        });
    }

    resetCounter(indexCount: number) {
        // [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
        const data = new Uint32Array([indexCount, 0, 0, 0, 0]);
        this.device.queue.writeBuffer(this.drawBuffer, 0, data);
    }
}
