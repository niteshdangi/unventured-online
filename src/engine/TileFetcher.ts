import { TileKey } from "./TileKey";

export type TileLayer = "albedo" | "elevation";

export class TileFetcher {
    private activeRequests = new Map<string, Promise<ImageBitmap | null>>();
    private abortControllers = new Map<string, AbortController>();
    private imageCache = new Map<string, ImageBitmap>();
    private maxCacheSize = 2000;
    private failedRequests = new Set<string>();

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

        if (this.failedRequests.has(cacheKey)) {
            return this.fallbackBitmapPromise;
        }

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

        const controller = new AbortController();
        this.abortControllers.set(cacheKey, controller);

        const promise = this.downloadImage(url, controller).catch((e) => {
            if (e.name === "AbortError") {
                return null;
            }
            console.warn(`Failed to fetch tile ${cacheKey}:`, e.message);
            this.failedRequests.add(cacheKey);
            return this.fallbackBitmapPromise;
        });

        this.activeRequests.set(cacheKey, promise);

        const result = await promise;

        this.activeRequests.delete(cacheKey);
        this.abortControllers.delete(cacheKey);

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

    cancelTile(tile: TileKey, layer: TileLayer) {
        const cacheKey = `${layer}_${tile.toString()}`;
        if (this.abortControllers.has(cacheKey)) {
            this.abortControllers.get(cacheKey)!.abort();
            this.abortControllers.delete(cacheKey);
            this.activeRequests.delete(cacheKey);
        }
    }

    private async downloadImage(url: string, controller: AbortController): Promise<ImageBitmap> {
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
            // Proxied through Vite to bypass browser CORS headers
            return `/mapzen-tiles/terrarium/${tile.level}/${tile.x}/${tile.y}.png`;
        } else {
            // ArcGIS World Imagery (highly reliable, no CORS issues, extremely fast)
            return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.level}/${tile.y}/${tile.x}`;
        }
    }

}
