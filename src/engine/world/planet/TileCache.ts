

/**
 * LRU Cache for managing heavy WebGL resources associated with Quadtree tiles
 * such as Geometries, Materials, and Textures.
 * Prevents VRAM exhaustion when traversing the planet.
 */
export class TileCache<T extends { dispose?: () => void }> {
    private cache = new Map<string, T>();
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    public get(key: string): T | undefined {
        const item = this.cache.get(key);
        if (item) {
            // Refresh item to the end of the Map (most recently used)
            this.cache.delete(key);
            this.cache.set(key, item);
        }
        return item;
    }

    public set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            this.evictLeastRecentlyUsed();
        }
        this.cache.set(key, value);
    }

    public has(key: string): boolean {
        return this.cache.has(key);
    }

    public delete(key: string): void {
        const item = this.cache.get(key);
        if (item) {
            if (item.dispose) {
                item.dispose();
            }
            this.cache.delete(key);
        }
    }

    public clear(): void {
        for (const item of this.cache.values()) {
            if (item.dispose) {
                item.dispose();
            }
        }
        this.cache.clear();
    }

    public get size(): number {
        return this.cache.size;
    }

    private evictLeastRecentlyUsed(): void {
        // Map keys are order-preserving. The first key is the oldest.
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
            this.delete(firstKey);
        }
    }
}
