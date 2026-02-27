import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AssetManager {
    private static instance: AssetManager;

    private textureLoader = new THREE.TextureLoader();
    private gltfLoader = new GLTFLoader();

    // Caches
    private textures = new Map<string, THREE.Texture>();
    private models = new Map<string, THREE.Group>();

    private constructor() {
        // Private constructor for singleton
    }

    public static getInstance(): AssetManager {
        if (!AssetManager.instance) {
            AssetManager.instance = new AssetManager();
        }
        return AssetManager.instance;
    }

    /**
     * Asynchronously loads a texture, caching it for future use.
     * Web Workers (ImageBitmapLoader) can be used under the hood in Three.js for textures.
     */
    public async loadTexture(url: string): Promise<THREE.Texture> {
        if (this.textures.has(url)) {
            return this.textures.get(url)!;
        }

        return new Promise((resolve, reject) => {
            this.textureLoader.load(
                url,
                (texture) => {
                    this.textures.set(url, texture);
                    resolve(texture);
                },
                undefined,
                (error) => reject(error)
            );
        });
    }

    /**
     * Asynchronously loads a GLTF/GLB model, caching the Scene Group.
     */
    public async loadModel(url: string): Promise<THREE.Group> {
        if (this.models.has(url)) {
            // Return a cloned version so multiple instances can be placed
            return this.models.get(url)!.clone();
        }

        return new Promise((resolve, reject) => {
            this.gltfLoader.load(
                url,
                (gltf) => {
                    this.models.set(url, gltf.scene);
                    resolve(gltf.scene.clone());
                },
                undefined,
                (error) => reject(error)
            );
        });
    }

    /**
     * Pre-fetches a set of critical assets to ensure zero-lag during initial gameplay.
     */
    public async prefetch(textures: string[], models: string[]): Promise<void> {
        const texturePromises = textures.map(url => this.loadTexture(url));
        const modelPromises = models.map(url => this.loadModel(url));
        await Promise.all([...texturePromises, ...modelPromises]);
        console.log(`AssetManager: Prefetched ${textures.length} textures and ${models.length} models.`);
    }

    /**
     * Loads raw data from a URL.
     */
    public async loadData(url: string): Promise<ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`AssetManager: Failed to load data from ${url}`);
        return await response.arrayBuffer();
    }
}
