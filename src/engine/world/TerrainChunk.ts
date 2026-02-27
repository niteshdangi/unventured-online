import * as THREE from 'three';
import { MapzenProvider } from './MapzenProvider';
import { PhysicsManager } from '../core/Physics';
import { WORLD_CONFIG } from './WorldConfig';

export class TerrainChunk {
    public mesh: THREE.Mesh | null = null;
    public waterMesh: THREE.Mesh | null = null;
    private collider: any = null;
    private rigidBody: any = null;
    public foliageMatrices: THREE.Matrix4[] = [];

    public x: number;
    public z: number;
    private size: number;
    private scene: THREE.Scene;

    constructor(
        scene: THREE.Scene,
        x: number,
        z: number,
        size: number
    ) {
        this.scene = scene;
        this.x = x;
        this.z = z;
        this.size = size;
    }

    public async build(physics: PhysicsManager, segments: number) {
        // Fetch elevation data from Mapzen
        const heightData = await this.getHeightData(segments);

        // 1. Create Terrain Mesh
        const geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;
        const colors = new Float32Array(positions.count * 3);

        for (let i = 0; i < positions.count; i++) {
            const h = heightData[i];
            positions.setY(i, h);

            // Color based on height and slope (simplified)
            if (h > 2000) {
                // Snow
                colors[i * 3] = 0.9;
                colors[i * 3 + 1] = 0.9;
                colors[i * 3 + 2] = 1.0;
            } else if (h > 1000) {
                // Rock
                colors[i * 3] = 0.5;
                colors[i * 3 + 1] = 0.4;
                colors[i * 3 + 2] = 0.3;
            } else {
                // Grass
                colors[i * 3] = 0.2;
                colors[i * 3 + 1] = 0.5;
                colors[i * 3 + 2] = 0.2;
            }
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // --- PERFORMANCE FIX: RECALCULATE BOUNDS FOR FRUSTUM CULLING ---
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.1
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(this.x * this.size, 0, this.z * this.size);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);

        // 2. Create Water Mesh (if needed)
        this.waterMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(this.size, this.size),
            new THREE.MeshStandardMaterial({ color: 0x0066ff, transparent: true, opacity: 0.6 })
        );
        this.waterMesh.rotateX(-Math.PI / 2);
        this.waterMesh.position.set(this.x * this.size, WORLD_CONFIG.mapzen.seaLevel, this.z * this.size);
        this.scene.add(this.waterMesh);

        // 3. Generate foliage matrices
        this.generateFoliage(heightData, segments);

        // 4. Create Physics Collider
        const vertices = positions.array as Float32Array;
        const indices = geometry.index!.array as Uint32Array;

        const colliderDesc = physics.RAPIER.ColliderDesc.trimesh(vertices, indices);
        this.rigidBody = physics.world.createRigidBody(physics.RAPIER.RigidBodyDesc.fixed());
        this.rigidBody.setTranslation({ x: this.x * this.size, y: 0, z: this.z * this.size }, true);
        this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);
    }

    private async getHeightData(segments: number): Promise<number[]> {
        const data: number[] = [];
        const res = segments + 1;

        // Origin in Lat/Lon
        const originLat = WORLD_CONFIG.mapzen.originLat;
        const originLon = WORLD_CONFIG.mapzen.originLon;

        for (let i = 0; i < res * res; i++) {
            const gridX = i % res;
            const gridZ = Math.floor(i / res);

            // Map grid to world units relative to chunk origin
            const worldX = (this.x * this.size) + (gridX / segments - 0.5) * this.size;
            const worldZ = (this.z * this.size) + (gridZ / segments - 0.5) * this.size;

            // Convert world meters to Lat/Lon offset (1 degree lat ~= 111,320 meters)
            const lat = originLat - (worldZ / 111320);
            const lon = originLon + (worldX / (111320 * Math.cos(originLat * Math.PI / 180)));

            const elevation = await MapzenProvider.getElevationLatLonAsync(lat, lon, WORLD_CONFIG.mapzen.zoom);
            data.push(elevation);
        }

        return data;
    }

    private generateFoliage(heightData: number[], segments: number) {
        this.foliageMatrices = [];
        const res = segments + 1;
        const dummy = new THREE.Object3D();

        for (let i = 0; i < heightData.length; i++) {
            const h = heightData[i];

            if (h < 1800 && h > WORLD_CONFIG.mapzen.seaLevel + 2) {
                const gridX = i % res;
                const gridZ = Math.floor(i / res);
                const noise = (Math.sin(gridX * 12.9898 + gridZ * 78.233) * 43758.5453) % 1;

                if (Math.abs(noise) > 0.98) {
                    const worldX = (this.x * this.size) + (gridX / segments - 0.5) * this.size;
                    const worldZ = (this.z * this.size) + (gridZ / segments - 0.5) * this.size;

                    dummy.position.set(worldX, h, worldZ);
                    dummy.rotation.y = noise * Math.PI;
                    const scale = 0.8 + Math.abs(noise) * 0.4;
                    dummy.scale.set(scale, scale, scale);
                    dummy.updateMatrix();
                    this.foliageMatrices.push(dummy.matrix.clone());
                }
            }
        }
    }

    public dispose(physics: PhysicsManager) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            (this.mesh.material as THREE.Material).dispose();
            this.mesh = null;
        }
        if (this.waterMesh) {
            this.scene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
            (this.waterMesh.material as THREE.Material).dispose();
            this.waterMesh = null;
        }
        if (this.collider) {
            physics.world.removeCollider(this.collider, true);
            this.collider = null;
        }
        if (this.rigidBody) {
            physics.world.removeRigidBody(this.rigidBody);
            this.rigidBody = null;
        }
    }
}
