import { TileKey } from "./TileKey";

export type TileLayer = "albedo" | "elevation";

export class TileFetcher {
    private activeRequests = new Map<string, Promise<ImageBitmap | null>>();
    private imageCache = new Map<string, ImageBitmap>();
    private maxCacheSize = 1000;

    // Create a 1x1 fallback bitmap
    private fallbackBitmapPromise: Promise<ImageBitmap>;

    constructor() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, 256, 256);
        this.fallbackBitmapPromise = createImageBitmap(canvas);
    }

    async fetchTile(tile: TileKey, layer: TileLayer): Promise<ImageBitmap | null> {
        const url = this.getTileUrl(tile, layer);
        const cacheKey = `${layer}_${tile.toString()}`;

        if (this.imageCache.has(cacheKey)) {
            // Move to end for LRU freshness
            const bmp = this.imageCache.get(cacheKey)!;
            this.imageCache.delete(cacheKey);
            this.imageCache.set(cacheKey, bmp);
            return bmp;
        }

        if (this.activeRequests.has(cacheKey)) {
            return this.activeRequests.get(cacheKey)!;
        }

        const promise = this.downloadImage(url).catch((e) => {
            console.warn(`Failed to fetch tile ${cacheKey}:`, e);
            return this.fallbackBitmapPromise;
        });

        this.activeRequests.set(cacheKey, promise);

        const result = await promise;

        this.activeRequests.delete(cacheKey);

        if (result && result !== (await this.fallbackBitmapPromise)) {
            this.imageCache.set(cacheKey, result);
            if (this.imageCache.size > this.maxCacheSize) {
                // Evict oldest
                const oldestKey = this.imageCache.keys().next().value;
                if (oldestKey) {
                    const bmp = this.imageCache.get(oldestKey);
                    // Standard way to forcefully release GPU memory for ImageBitmaps if supported
                    if (bmp && "close" in bmp) {
                        (bmp as any).close();
                    }
                    this.imageCache.delete(oldestKey);
                }
            }
        }

        return result;
    }

    private async downloadImage(url: string): Promise<ImageBitmap> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} for ${url}`);
            }
            const blob = await response.blob();
            return await createImageBitmap(blob, {
                imageOrientation: "flipY"
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private getTileUrl(tile: TileKey, layer: TileLayer): string {
        if (layer === "elevation") {
            // Standard AWS Public Dataset
            return `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${tile.level}/${tile.x}/${tile.y}.png`;
        } else {
            // ArcGIS World Imagery (highly reliable, no CORS issues, extremely fast)
            return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.level}/${tile.y}/${tile.x}`;
        }
    }

}
