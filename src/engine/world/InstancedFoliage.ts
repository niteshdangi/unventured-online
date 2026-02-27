import * as THREE from 'three';
import { AssetManager } from '../core/AssetManager';
import { WORLD_CONFIG } from './WorldConfig';

export class InstancedFoliage {
    private mesh: THREE.InstancedMesh | null = null;
    private dummy: THREE.Object3D;
    private scene: THREE.Scene;

    // Config
    private maxInstances: number;
    private count: number = 0;

    // Store pending positions if addInstance is called before the model loads
    private pendingInstances: { position: THREE.Vector3, scale: number }[] = [];

    constructor(scene: THREE.Scene, maxInstances: number = 100000) {
        this.maxInstances = maxInstances;
        this.scene = scene;
        this.dummy = new THREE.Object3D();

        this.loadModel();
    }

    private async loadModel() {
        try {
            const assetManager = AssetManager.getInstance();
            const cfg = WORLD_CONFIG.foliage;
            const gltfGroup = await assetManager.loadModel(cfg.modelPath);

            let treeGeometry: THREE.BufferGeometry | null = null;
            let treeMaterial: THREE.Material | THREE.Material[] | null = null;

            // Traverse the loaded GLTF to find the specific mesh defined in config
            gltfGroup.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (!treeGeometry && child.name.includes(cfg.modelTargetName)) {
                        treeGeometry = child.geometry.clone();
                        treeMaterial = child.material;
                    }
                }
            });

            if (!treeGeometry || !treeMaterial) {
                console.warn("InstancedFoliage: Could not find valid mesh in GLTF.");
                return;
            }

            // Correct orientation: GLTFs are often Z-up, but Three.js is Y-up.
            // If the tree is "laying down", it needs a -90 degree rotation around X.
            (treeGeometry as THREE.BufferGeometry).rotateX(-Math.PI / 2);

            this.mesh = new THREE.InstancedMesh(treeGeometry, treeMaterial, this.maxInstances);
            this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.mesh.castShadow = true;
            this.mesh.receiveShadow = true;
            this.mesh.frustumCulled = false; // Fix: Prevent entire instanced mesh from disappearing when origin is off-screen

            this.scene.add(this.mesh);

            // Process any trees that spawned before we loaded
            for (const pending of this.pendingInstances) {
                this.addInstance(pending.position, pending.scale);
            }
            this.pendingInstances = [];

        } catch (e) {
            console.error("Failed to load foliage GLTF:", e);
        }
    }

    public addInstance(position: THREE.Vector3, scale: number = 1) {
        if (!this.mesh) {
            this.pendingInstances.push({ position: position.clone(), scale });
            return;
        }

        if (this.count >= this.maxInstances) return;

        this.dummy.position.copy(position);
        this.dummy.rotation.y = (position.x * 12.9898 + position.z * 78.233) % (Math.PI * 2);
        const finalScale = scale * 1.5;
        this.dummy.scale.set(finalScale, finalScale, finalScale);
        this.dummy.updateMatrix();

        this.mesh.setMatrixAt(this.count, this.dummy.matrix);
        this.count++;
    }

    /**
     * Finalizes the instances and pushes them to the GPU.
     * Use this after a batch of addInstance calls.
     */
    public update() {
        if (!this.mesh) return;
        this.mesh.count = this.count;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Directly sets all instances from an array of matrices for maximum performance.
     */
    public setInstances(matrices: THREE.Matrix4[]) {
        if (!this.mesh) return;

        this.count = Math.min(matrices.length, this.maxInstances);
        for (let i = 0; i < this.count; i++) {
            this.mesh.setMatrixAt(i, matrices[i]);
        }

        this.mesh.count = this.count;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    public removeAllInstances() {
        this.count = 0;
        this.pendingInstances = [];
        if (this.mesh) {
            this.mesh.count = 0;
            this.mesh.instanceMatrix.needsUpdate = true;
        }
    }
}
