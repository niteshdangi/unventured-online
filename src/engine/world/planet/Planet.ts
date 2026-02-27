import * as THREE from 'three';
import { QuadtreeNode } from './QuadtreeNode';

export class Planet {
    private scene: THREE.Scene;
    private rootGroup: THREE.Group;
    private faces: QuadtreeNode[] = [];

    // Engine configurations
    private readonly maxLodLevel = 20; // Up to ~10cm precision depending on radius
    private readonly sseThreshold = 2.0; // Subdivide if error > 2 pixels

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.rootGroup = new THREE.Group();
        this.scene.add(this.rootGroup);
    }

    public init() {
        // Initialize the 6 root faces of the cube-sphere
        for (let i = 0; i < 6; i++) {
            // face, level, x, y, minX, maxX, minY, maxY
            const faceNode = new QuadtreeNode(0, i, 0, 0, -1, 1, -1, 1, undefined);
            this.faces.push(faceNode);
        }
    }

    public update(camera: THREE.PerspectiveCamera, screenHeight: number) {
        // Ensure matrices are up to date before computing local space
        this.rootGroup.updateMatrixWorld(true);

        const localCameraPos = camera.position.clone();
        this.rootGroup.worldToLocal(localCameraPos);

        const cameraParams = {
            position: localCameraPos, // 64-bit precise local sphere coordinates
            frustum: new THREE.Frustum(),
            fov: camera.fov,
            screenHeight: screenHeight
        };

        const projScreenMatrix = new THREE.Matrix4();
        projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        projScreenMatrix.multiply(this.rootGroup.matrixWorld);
        cameraParams.frustum.setFromProjectionMatrix(projScreenMatrix);

        // Traverse the Quadtree for each face
        for (const face of this.faces) {
            face.update(cameraParams, this.sseThreshold, this.maxLodLevel, this.rootGroup);
        }
    }

    public getRootGroup(): THREE.Group {
        return this.rootGroup;
    }

    public dispose() {
        for (const face of this.faces) {
            face.destroy();
        }
        this.scene.remove(this.rootGroup);
    }
}
