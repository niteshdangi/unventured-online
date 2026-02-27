export class MapzenProvider {
    // We cache tile image data with a Max Capacity LRU policy.
    // Each 256x256 ImageData is ~262KB. 256 tiles = ~67MB.
    private static readonly MAX_CACHE_SIZE = 256;
    private static tileCache = new Map<string, ImageData>();
    private static pendingFetches = new Map<string, Promise<ImageData>>();



    public static async preloadTilesForBounds(
        minLat: number, minLon: number,
        maxLat: number, maxLon: number,
        zoom: number
    ): Promise<void> {

        const minTileInfo = this.latLonToTile(maxLat, minLon, zoom); // North West
        const maxTileInfo = this.latLonToTile(minLat, maxLon, zoom); // South East

        const tilePromises: Promise<void>[] = [];
        for (let tx = minTileInfo.tx; tx <= maxTileInfo.tx; tx++) {
            for (let ty = minTileInfo.ty; ty <= maxTileInfo.ty; ty++) {
                tilePromises.push(this.loadTile(zoom, tx, ty).then(() => { }));
            }
        }

        await Promise.all(tilePromises);
    }

    public static async getElevationLatLonAsync(lat: number, lon: number, zoom: number): Promise<number> {
        const { tx, ty } = this.latLonToTile(lat, lon, zoom);
        await this.loadTile(zoom, tx, ty);
        return this.sampleElevationLatLon(lat, lon, zoom);
    }

    public static sampleElevationLatLon(lat: number, lon: number, zoom: number): number {
        const { tx, ty, px, py } = this.latLonToTile(lat, lon, zoom);

        // Wrap tile x around the world, clamp tile y just in case
        const numTiles = Math.pow(2, zoom);
        const wrappedTx = (tx % numTiles + numTiles) % numTiles;

        if (ty < 0 || ty >= numTiles) return 0; // outside bounds, return sea level

        const tileId = `${zoom}/${wrappedTx}/${ty}`;
        const imgData = this.tileCache.get(tileId);

        if (!imgData) {
            // Should not happen if pre-fetched correctly, but fallback cleanly
            return 0;
        }

        // --- LRU Cache Access Update ---
        // By deleting and re-inserting, we move it to the end of the Map (most recently used)
        this.tileCache.delete(tileId);
        this.tileCache.set(tileId, imgData);

        const xFloor = Math.floor(px);
        const yFloor = Math.floor(py);

        const dx = px - xFloor;
        const dy = py - yFloor;

        const h00 = this.getElevationFromTile(zoom, tx, ty, xFloor, yFloor);
        const h10 = this.getElevationFromTile(zoom, tx, ty, xFloor + 1, yFloor);
        const h01 = this.getElevationFromTile(zoom, tx, ty, xFloor, yFloor + 1);
        const h11 = this.getElevationFromTile(zoom, tx, ty, xFloor + 1, yFloor + 1);

        const top = h00 * (1 - dx) + h10 * dx;
        const bottom = h01 * (1 - dx) + h11 * dx;

        return top * (1 - dy) + bottom * dy;
    }

    private static getElevationFromTile(zoom: number, tx: number, ty: number, px: number, py: number): number {
        let resolveTx = tx;
        let resolveTy = ty;
        let resolvePx = px;
        let resolvePy = py;

        // If interpolation crosses the tile boundary, fetch from the adjacent tile flawlessly
        if (resolvePx >= 256) {
            resolvePx -= 256;
            resolveTx += 1;
        }
        if (resolvePy >= 256) {
            resolvePy -= 256;
            resolveTy += 1;
        }

        const numTiles = Math.pow(2, zoom);
        const wrappedTx = (resolveTx % numTiles + numTiles) % numTiles;

        if (resolveTy < 0 || resolveTy >= numTiles) return 0;

        const tileId = `${zoom}/${wrappedTx}/${resolveTy}`;
        const imgData = this.tileCache.get(tileId);

        if (!imgData) {
            return 0; // Fallback to 0 if tile unloaded (should be avoided by generous preload bounding boxes)
        }

        // LRU Tracking
        this.tileCache.delete(tileId);
        this.tileCache.set(tileId, imgData);

        const index = (resolvePy * 256 + resolvePx) * 4;
        const r = imgData.data[index];
        const g = imgData.data[index + 1];
        const b = imgData.data[index + 2];
        return (r * 256 + g + b / 256) - 32768;
    }

    private static latLonToTile(lat: number, lon: number, zoom: number) {
        // Convert to Normalized Mercator (0 to 1) 
        const radLat = lat * Math.PI / 180;
        const normX = (lon + 180) / 360;
        let normY = (1 - Math.log(Math.tan(radLat) + 1 / Math.cos(radLat)) / Math.PI) / 2;

        // Clamp Y to prevent pole infinity
        if (normY < 0) normY = 0;
        if (normY > 1) normY = 1;

        const numTiles = Math.pow(2, zoom);
        const tileX = Math.floor(normX * numTiles);
        const tileY = Math.floor(normY * numTiles);

        const pixelX = (normX * numTiles - tileX) * 256;
        const pixelY = (normY * numTiles - tileY) * 256;

        return { tx: tileX, ty: tileY, px: pixelX, py: pixelY };
    }

    private static loadTile(zoom: number, x: number, y: number): Promise<ImageData> {
        const numTiles = Math.pow(2, zoom);
        const wrappedX = (x % numTiles + numTiles) % numTiles;
        const tileId = `${zoom}/${wrappedX}/${y}`;

        if (this.tileCache.has(tileId)) {
            // Update LRU usage
            const imgData = this.tileCache.get(tileId)!;
            this.tileCache.delete(tileId);
            this.tileCache.set(tileId, imgData);
            return Promise.resolve(imgData);
        }

        if (this.pendingFetches.has(tileId)) {
            return this.pendingFetches.get(tileId)!;
        }

        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${wrappedX}/${y}.png`;

        const promise = new Promise<ImageData>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) return reject("Failed to get 2d context");

                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, 256, 256);

                this.addTileToCache(tileId, imageData);
                this.pendingFetches.delete(tileId);
                resolve(imageData);
            };
            img.onerror = () => {
                console.error(`Failed to load tile: ${url}`);
                // Instead of failing completely, create a flat sea-level tile
                const canvas = document.createElement("canvas");
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext("2d");
                // Base 0 elevation color in terrarium: R: 128, G: 0, B: 0 => 128*256+0+0-32768 = 0
                ctx!.fillStyle = "rgb(128, 0, 0)";
                ctx!.fillRect(0, 0, 256, 256);
                const buf = ctx!.getImageData(0, 0, 256, 256);

                this.addTileToCache(tileId, buf);
                this.pendingFetches.delete(tileId);
                resolve(buf);
            };
            img.src = url;
        });

        this.pendingFetches.set(tileId, promise);
        return promise;
    }

    private static addTileToCache(tileId: string, imageData: ImageData) {
        if (this.tileCache.size >= this.MAX_CACHE_SIZE) {
            // Map keys iterate in insertion order, so the first key is the oldest (Least Recently Used)
            const oldestKey = this.tileCache.keys().next().value;
            if (oldestKey) {
                this.tileCache.delete(oldestKey);
            }
        }
        this.tileCache.set(tileId, imageData);
    }
}
