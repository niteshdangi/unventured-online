import * as THREE from 'three';
import { SphericalMath } from './SphericalMath';
import { MapzenProvider } from '../MapzenProvider';

export class QuadtreeNode {
    public readonly level: number;
    public readonly face: number; // 0-5 corresponding to cube faces
    public readonly x: number;
    public readonly y: number;
    public readonly geometricError: number;
    public readonly boundingSphere: THREE.Sphere;

    public parent?: QuadtreeNode;
    public children?: QuadtreeNode[];
    public mesh?: THREE.Mesh;
    private isGenerating = false;

    // Bounds on the root face [-1, 1]
    private readonly minX: number;
    private readonly maxX: number;
    private readonly minY: number;
    private readonly maxY: number;

    private readonly planetRadius = 6371000; // Earth radius in meters
    // Material cache or shared materials should be used, but for now standard material
    private static material = new THREE.MeshStandardMaterial({ color: 0x44aa44, wireframe: true });

    constructor(
        level: number,
        face: number,
        x: number,
        y: number,
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
        parent?: QuadtreeNode
    ) {
        this.level = level;
        this.face = face;
        this.x = x;
        this.y = y;
        this.minX = minX;
        this.maxX = maxX;
        this.minY = minY;
        this.maxY = maxY;
        this.parent = parent;

        this.geometricError = SphericalMath.calculateGeometricError(this.level, this.planetRadius);
        this.boundingSphere = this.calculateBoundingSphere();
    }

    private calculateBoundingSphere(): THREE.Sphere {
        // This is a simplified bounding sphere. 
        // We get the center point, project it, and estimate radius.
        const centerCube = this.faceToCubePoint((this.minX + this.maxX) / 2, (this.minY + this.maxY) / 2);
        const centerSphere = SphericalMath.cubeToSphere(centerCube, this.planetRadius);

        // Corner point to determine radius
        const cornerCube = this.faceToCubePoint(this.minX, this.minY);
        const cornerSphere = SphericalMath.cubeToSphere(cornerCube, this.planetRadius);

        const radius = centerSphere.distanceTo(cornerSphere) * 1.1; // Add 10% for elevation/skirts

        return new THREE.Sphere(centerSphere, radius);
    }

    private faceToCubePoint(u: number, v: number): THREE.Vector3 {
        // Maps u,v [-1, 1] to the correct 3D cube face
        switch (this.face) {
            case 0: return new THREE.Vector3(1, v, -u);   // +X
            case 1: return new THREE.Vector3(-1, v, u);   // -X
            case 2: return new THREE.Vector3(u, 1, -v);   // +Y
            case 3: return new THREE.Vector3(u, -1, v);   // -Y
            case 4: return new THREE.Vector3(u, v, 1);    // +Z
            case 5: return new THREE.Vector3(-u, v, -1);  // -Z
            default: return new THREE.Vector3(0, 0, 0);
        }
    }

    public update(cameraParams: { position: THREE.Vector3, frustum: THREE.Frustum, fov: number, screenHeight: number }, sseThreshold: number, maxLevel: number, sceneGroup: THREE.Group) {
        // 1. Frustum Culling
        if (!cameraParams.frustum.intersectsSphere(this.boundingSphere)) {
            this.merge(); // Destroy children if we are looking away
            return;
        }

        // 2. Horizon Culling
        if (SphericalMath.isBelowHorizon(cameraParams.position, this.boundingSphere, this.planetRadius)) {
            this.merge();
            return;
        }

        // 3. Screen Space Error LOD Decision
        const distance = this.boundingSphere.center.distanceTo(cameraParams.position);

        // Adjust distance if camera is inside the sphere to prevent infinite SSE
        const safeDistance = Math.max(distance - this.boundingSphere.radius, 1.0);

        const sse = SphericalMath.calculateSSE(this.geometricError, safeDistance, cameraParams.screenHeight, cameraParams.fov);

        if (sse > sseThreshold && this.level < maxLevel) {
            this.subdivide();

            // Hide own mesh if subdivided
            if (this.mesh) this.mesh.visible = false;

            // Recurse children
            for (const child of this.children!) {
                child.update(cameraParams, sseThreshold, maxLevel, sceneGroup);
            }
        } else {
            this.merge();
            this.render(sceneGroup); // Ensure own mesh is visible/generated
        }
    }

    public subdivide() {
        if (this.children) return; // Already subdivided

        const midX = (this.minX + this.maxX) / 2;
        const midY = (this.minY + this.maxY) / 2;
        const nextLevel = this.level + 1;
        const subX = this.x * 2;
        const subY = this.y * 2;

        this.children = [
            new QuadtreeNode(nextLevel, this.face, subX, subY, this.minX, midX, this.minY, midY, this),         // Bottom Left
            new QuadtreeNode(nextLevel, this.face, subX + 1, subY, midX, this.maxX, this.minY, midY, this),     // Bottom Right
            new QuadtreeNode(nextLevel, this.face, subX, subY + 1, this.minX, midX, midY, this.maxY, this),     // Top Left
            new QuadtreeNode(nextLevel, this.face, subX + 1, subY + 1, midX, this.maxX, midY, this.maxY, this)  // Top Right
        ];
    }

    public merge() {
        if (!this.children) return;

        for (const child of this.children) {
            child.destroy();
        }
        this.children = undefined;

        if (this.mesh) this.mesh.visible = true;
        this.isGenerating = false;
    }

    private render(sceneGroup: THREE.Group) {
        if (this.mesh || this.isGenerating) {
            if (this.mesh) this.mesh.visible = true;
            return;
        }

        this.isGenerating = true;
        this.generateAsyncMesh(sceneGroup);
    }

    private async generateAsyncMesh(sceneGroup: THREE.Group) {
        // Generate placeholder mesh
        const segments = 16;
        const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
        const positions = geometry.attributes.position;

        // Base zoom level heuristic (Root is ~zoom 2, subdividing adds resolution)
        const zoom = Math.min(this.level + 2, 14);

        const verticesData: { i: number, lat: number, lon: number, promise: Promise<number>, point: THREE.Vector3 }[] = [];

        for (let i = 0; i < positions.count; i++) {
            // Map plane coords (-1 to 1) to tile coords based on min/max X/Y
            const u = this.minX + (positions.getX(i) * 0.5 + 0.5) * (this.maxX - this.minX);
            const v = this.minY + (positions.getY(i) * 0.5 + 0.5) * (this.maxY - this.minY);

            const cubePoint = this.faceToCubePoint(u, v);
            const spherePoint = SphericalMath.cubeToSphere(cubePoint, this.planetRadius);

            const { lat, lon } = SphericalMath.sphereToLatLon(spherePoint);

            verticesData.push({
                i, lat, lon, point: spherePoint,
                promise: MapzenProvider.getElevationLatLonAsync(lat, lon, zoom)
            });
        }

        // Wait for all unique tile images to download and sample their elevation
        await Promise.all(verticesData.map(v => v.promise));

        // Ensure we haven't been merged/destroyed while waiting for the network
        if (!this.isGenerating) return;

        for (const data of verticesData) {
            // Re-sample synchronously now that we guarantee the tile is cached
            const elevation = MapzenProvider.sampleElevationLatLon(data.lat, data.lon, zoom);

            // Push point out by terrain height + scaling down terrain effect mildly for looks
            const elevatedPoint = data.point.normalize().multiplyScalar(this.planetRadius + (elevation * 1.5));
            positions.setXYZ(data.i, elevatedPoint.x, elevatedPoint.y, elevatedPoint.z);
        }

        geometry.computeVertexNormals();

        this.mesh = new THREE.Mesh(geometry, QuadtreeNode.material);
        sceneGroup.add(this.mesh);
        this.isGenerating = false;

        // Note: Skirt generation should happen here to hide LOD cracks!
    }

    public destroy() {
        this.isGenerating = false;
        this.merge(); // Destroy children
        if (this.mesh) {
            this.mesh.geometry.dispose();
            // Don't dispose static material
            if (this.mesh.parent) {
                this.mesh.parent.remove(this.mesh);
            }
            this.mesh = undefined;
        }
    }
}
