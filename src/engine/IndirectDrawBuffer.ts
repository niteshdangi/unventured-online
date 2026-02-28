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

export class IndirectDrawBuffer {
    private device: GPUDevice;

    private drawBuffer!: GPUBuffer;

    private capacity: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    getDrawBuffer(): GPUBuffer {
        return this.drawBuffer;
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

        if (this.drawBuffer) this.drawBuffer.destroy();

        // SINGLE 20-byte indirect struct buffer
        this.drawBuffer = this.device.createBuffer({
            size: BYTES_PER_DRAW,
            usage:
                GPUBufferUsage.INDIRECT |
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_DST,
            mappedAtCreation: false
        });
    }

    setDrawCommand(indexCount: number, instanceCount: number) {
        // [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
        const data = new Uint32Array([indexCount, instanceCount, 0, 0, 0]);
        this.device.queue.writeBuffer(this.drawBuffer, 0, data);
    }
}
