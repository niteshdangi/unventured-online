import * as THREE from 'three';
import { TerrainChunk } from './TerrainChunk';
import { PhysicsManager } from '../core/Physics';
import { InstancedFoliage } from './InstancedFoliage';
import { WORLD_CONFIG } from './WorldConfig';

export class ChunkManager {
    private chunks = new Map<string, TerrainChunk>();
    public readonly chunkSize = WORLD_CONFIG.chunk.size;
    private scene: THREE.Scene;
    private foliage!: InstancedFoliage;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public init(scene: THREE.Scene) {
        this.scene = scene;
        this.foliage = new InstancedFoliage(scene);
    }

    private updateCooldown = 0;

    public update(camera: THREE.PerspectiveCamera, physics: PhysicsManager, delta: number) {
        this.updateCooldown -= delta;
        if (this.updateCooldown > 0) return;
        this.updateCooldown = 0.5; // Only run chunk calculus twice a second

        const playerPos = camera.position;

        // Determine which chunk the camera is currently in
        const currentChunkX = Math.round(playerPos.x / this.chunkSize);
        const currentChunkZ = Math.round(playerPos.z / this.chunkSize);

        const activeChunkCoords = new Set<string>();
        const chunksToLoad: { x: number, z: number, dist: number }[] = [];

        const loadRadius = Math.ceil(WORLD_CONFIG.chunk.loadDistance / this.chunkSize);
        const unloadRadius = Math.ceil(WORLD_CONFIG.chunk.unloadDistance / this.chunkSize);

        for (let xOffset = -unloadRadius; xOffset <= unloadRadius; xOffset++) {
            for (let zOffset = -unloadRadius; zOffset <= unloadRadius; zOffset++) {
                const chunkX = currentChunkX + xOffset;
                const chunkZ = currentChunkZ + zOffset;
                const chunkId = this.getChunkId(chunkX, chunkZ);

                const distanceSq = (xOffset * xOffset) + (zOffset * zOffset);

                if (distanceSq <= loadRadius * loadRadius) {
                    activeChunkCoords.add(chunkId);
                    if (!this.chunks.has(chunkId)) {
                        chunksToLoad.push({ x: chunkX, z: chunkZ, dist: distanceSq });
                    }
                } else if (distanceSq <= unloadRadius * unloadRadius) {
                    if (this.chunks.has(chunkId)) {
                        activeChunkCoords.add(chunkId);
                    }
                }
            }
        }

        // Unload chunks
        for (const [chunkId, chunk] of this.chunks.entries()) {
            if (!activeChunkCoords.has(chunkId)) {
                this.unloadChunk(chunkId, chunk, physics);
            }
        }

        // Sort by distance
        chunksToLoad.sort((a, b) => a.dist - b.dist);

        // Load 2 chunks per tick
        const MAX_LOADS_PER_TICK = 2;
        for (let i = 0; i < Math.min(MAX_LOADS_PER_TICK, chunksToLoad.length); i++) {
            const c = chunksToLoad[i];
            this.chunks.set(this.getChunkId(c.x, c.z), {} as TerrainChunk);
            this.loadChunk(c.x, c.z, physics, WORLD_CONFIG.chunk.segments);
        }
    }

    private async loadChunk(x: number, z: number, physics: PhysicsManager, segments: number) {
        const chunkId = this.getChunkId(x, z);
        const chunk = new TerrainChunk(this.scene, x, z, this.chunkSize);
        await chunk.build(physics, segments);

        // If it was supposed to be unloaded while building, kill it
        if (this.chunks.get(chunkId) === undefined) {
            chunk.dispose(physics);
            return;
        }

        this.chunks.set(chunkId, chunk);
        this.refreshFoliage();
    }

    private unloadChunk(id: string, chunk: TerrainChunk, physics: PhysicsManager) {
        if (chunk.dispose) {
            chunk.dispose(physics);
        }
        this.chunks.delete(id);
        this.refreshFoliage();
    }

    private refreshFoliage() {
        if (!this.foliage) return;

        this.foliage.removeAllInstances();

        // Collect all foliage matrices from all active chunks
        const allMatrices: THREE.Matrix4[] = [];
        for (const chunk of this.chunks.values()) {
            if (chunk.mesh && chunk.foliageMatrices) {
                for (const matrix of chunk.foliageMatrices) {
                    allMatrices.push(matrix);
                }
            }
        }

        this.foliage.setInstances(allMatrices);
    }

    private getChunkId(x: number, z: number): string {
        return `${x},${z}`;
    }
}
