import { TileKey } from "./TileKey";

export class TextureAtlas {
    public texture!: GPUTexture;
    public sampler!: GPUSampler;

    private layerCapacity: number;
    private tileSize: number;
    private freeLayers: number[] = [];
    private activeLayers = new Map<string, number>();

    public isReady = false;

    private device: GPUDevice;
    private format: GPUTextureFormat;
    private emptyData: Uint8Array;

    constructor(
        device: GPUDevice,
        format: GPUTextureFormat,
        tileSize = 256,
        capacity = 512
    ) {
        this.device = device;
        this.format = format;
        this.tileSize = tileSize;
        this.layerCapacity = capacity;
        this.emptyData = new Uint8Array(tileSize * tileSize * 4);

        // Populate free layers queue
        for (let i = 0; i < capacity; i++) {
            this.freeLayers.push(i);
        }
    }

    initialize() {
        this.texture = this.device.createTexture({
            size: [this.tileSize, this.tileSize, this.layerCapacity],
            format: this.format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.sampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });

        this.isReady = true;
    }

    allocateLayer(tileKey: TileKey): number | null {
        const key = tileKey.toString();
        if (this.activeLayers.has(key)) {
            return this.activeLayers.get(key)!;
        }

        if (this.freeLayers.length === 0) {
            console.warn("Texture atlas is full!");
            return null;
        }

        const layer = this.freeLayers.pop()!;
        this.activeLayers.set(key, layer);
        this.clearLayer(layer);
        return layer;
    }

    private clearLayer(layer: number) {
        if (!this.isReady || !this.texture) return;
        this.device.queue.writeTexture(
            { texture: this.texture, origin: [0, 0, layer] },
            this.emptyData.buffer,
            { bytesPerRow: this.tileSize * 4, rowsPerImage: this.tileSize },
            [this.tileSize, this.tileSize, 1]
        );
    }

    freeLayer(tileKey: TileKey) {
        const key = tileKey.toString();
        const layer = this.activeLayers.get(key);
        if (layer !== undefined) {
            this.activeLayers.delete(key);
            this.freeLayers.push(layer);
        }
    }

    hasLayer(tileKey: TileKey): boolean {
        return this.activeLayers.has(tileKey.toString());
    }

    getLayer(tileKey: TileKey): number {
        return this.activeLayers.get(tileKey.toString()) ?? 0;
    }

    uploadTexture(layer: number, bitmap: ImageBitmap) {
        if (!this.isReady || !this.texture) return;
        if (bitmap.width !== this.tileSize || bitmap.height !== this.tileSize) {
            console.warn(`Attempted to upload ${bitmap.width}x${bitmap.height} but atlas is ${this.tileSize}x${this.tileSize}`);
            return;
        }
        this.device.queue.copyExternalImageToTexture(
            { source: bitmap, flipY: true },
            { texture: this.texture, origin: [0, 0, layer] },
            [this.tileSize, this.tileSize]
        );
    }
}
