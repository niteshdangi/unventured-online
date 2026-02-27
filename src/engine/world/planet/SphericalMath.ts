import * as THREE from 'three';

export class SphericalMath {
    /**
     * Converts a point on a cube to a point on a sphere using equal-area mapping.
     * This avoids the severe distortion at the corners of a naive normalized cube.
     * 
     * @param cubePos The position on the cube face to map.
     * @param radius The radius of the target sphere.
     * @returns A new Vector3 mapped to the sphere's surface.
     */
    public static cubeToSphere(cubePos: THREE.Vector3, radius: number): THREE.Vector3 {
        // Normalize the coordinate to a [-1, 1] range relative to the cube face
        const max = Math.max(Math.abs(cubePos.x), Math.abs(cubePos.y), Math.abs(cubePos.z));
        if (max === 0) return new THREE.Vector3(0, 0, 0);

        const x = cubePos.x / max;
        const y = cubePos.y / max;
        const z = cubePos.z / max;

        const x2 = x * x;
        const y2 = y * y;
        const z2 = z * z;

        // Equal-area mapping formula
        const sphereX = x * Math.sqrt(1.0 - (y2 / 2.0) - (z2 / 2.0) + (y2 * z2 / 3.0));
        const sphereY = y * Math.sqrt(1.0 - (z2 / 2.0) - (x2 / 2.0) + (z2 * x2 / 3.0));
        const sphereZ = z * Math.sqrt(1.0 - (x2 / 2.0) - (y2 / 2.0) + (x2 * y2 / 3.0));

        return new THREE.Vector3(sphereX, sphereY, sphereZ).multiplyScalar(radius);
    }

    /**
     * Evaluates whether a tile is hidden securely behind the planetary horizon.
     * 
     * @param cameraAbsPos The absolute position of the camera relative to the planet center.
     * @param boundingSphere The bounding sphere of the tile.
     * @param planetRadius The radius of the planet.
     * @returns True if the tile is verifiably completely occluded by the planet's curvature.
     */
    public static isBelowHorizon(
        cameraAbsPos: THREE.Vector3,
        boundingSphere: THREE.Sphere,
        planetRadius: number
    ): boolean {
        const distToCamera = cameraAbsPos.length();
        if (distToCamera <= planetRadius) {
            // Camera is underground or exactly on surface, can't reliably cull just yet
            return false;
        }

        const cameraNorm = cameraAbsPos.clone().normalize();
        const tileNorm = boundingSphere.center.clone().normalize();

        // Angle between camera and tile center from planet center
        const angleToTile = Math.acos(THREE.MathUtils.clamp(cameraNorm.dot(tileNorm), -1, 1));

        // Angle between camera and horizon from planet center
        const angleToHorizon = Math.acos(planetRadius / distToCamera);

        // Angular radius of the tile's bounding sphere from planet center
        const tileAngularRadius = boundingSphere.radius / planetRadius;

        // If the closest edge of the tile is beyond the horizon, cull it safely
        return (angleToTile - tileAngularRadius) > angleToHorizon;
    }

    /**
     * Calculates the estimated geometric error (arc length) for a given LOD level.
     */
    public static calculateGeometricError(level: number, radius: number): number {
        return (radius * Math.PI) / Math.pow(2, level + 1);
    }

    /**
     * Calculates the Screen Space Error (SSE) for determining LOD subdivision.
     */
    public static calculateSSE(
        geometricError: number,
        distanceToCamera: number,
        screenHeight: number,
        fovDegrees: number
    ): number {
        const fovRadians = THREE.MathUtils.degToRad(fovDegrees);
        return (geometricError / Math.max(distanceToCamera, 1.0)) * (screenHeight / (2 * Math.tan(fovRadians / 2)));
    }

    /**
     * Converts a 3D cartesian point on the sphere to geographic latitude and longitude.
     * Assumes Three.js coordinates (Y is up).
     * @param spherePos The position on the sphere.
     * @returns Object containing lat and lon in degrees.
     */
    public static sphereToLatLon(spherePos: THREE.Vector3): { lat: number, lon: number } {
        const radius = spherePos.length();
        if (radius === 0) return { lat: 0, lon: 0 };

        // Latitude: Angle from the XZ plane (-90 to +90 degrees)
        const latRad = Math.asin(spherePos.y / radius);

        // Longitude: Angle around the Y axis (-180 to +180 degrees)
        // Three.js standard is +Z is toward the screen, +X is right.
        // atan2(x, z) maps +Z to 0. 
        // Typically, +Z is Prime Meridian, +X is 90° East.
        const lonRad = Math.atan2(spherePos.x, spherePos.z);

        return {
            lat: THREE.MathUtils.radToDeg(latRad),
            lon: THREE.MathUtils.radToDeg(lonRad)
        };
    }
}
