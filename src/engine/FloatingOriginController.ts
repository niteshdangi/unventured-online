/*
  FloatingOriginController.ts
  -------------------------------------------------------
  High-level integration layer between simulation state
  and rendering system for 1:1 planetary scale.

  Responsibilities:
  - Maintain player geodetic position (double precision)
  - Maintain floating origin anchor
  - Provide local ENU transform for GPU systems
  - Handle automatic re-centering
  - Provide stable camera transform basis

  This file depends on PlanetMath.ts
*/

import {
    type Geodetic,
    type Vec3,
    FloatingOrigin,
    degToRad
} from "./PlanetMath";

export interface PlayerState {
    geodetic: Geodetic;
}

export interface CameraLocalState {
    position: Vec3;     // local ENU
    forward: Vec3;
    up: Vec3;
}

export class FloatingOriginController {
    private floatingOrigin: FloatingOrigin;
    private player: PlayerState;

    private recenterThreshold: number;

    constructor(initialLatDeg: number, initialLonDeg: number) {
        const initialGeodetic: Geodetic = {
            lat: degToRad(initialLatDeg),
            lon: degToRad(initialLonDeg),
            height: 0
        };

        this.player = { geodetic: initialGeodetic };
        this.floatingOrigin = new FloatingOrigin(initialGeodetic);

        // default: 2km recenter radius
        this.recenterThreshold = 2000;
    }

    // ------------------------------------------------------
    // PLAYER STATE
    // ------------------------------------------------------

    getPlayerGeodetic(): Geodetic {
        return { ...this.player.geodetic };
    }

    setPlayerGeodetic(g: Geodetic) {
        this.player.geodetic = { ...g };
    }

    movePlayerGeodetic(deltaLatRad: number, deltaLonRad: number, deltaHeight: number) {
        this.player.geodetic.lat += deltaLatRad;
        this.player.geodetic.lon += deltaLonRad;
        this.player.geodetic.height += deltaHeight;
    }

    // ------------------------------------------------------
    // LOCAL SPACE TRANSFORM
    // ------------------------------------------------------

    getPlayerLocalPosition(): Vec3 {
        return this.floatingOrigin.toLocal(this.player.geodetic);
    }

    // Converts arbitrary world geodetic position to local ENU
    worldToLocal(g: Geodetic): Vec3 {
        return this.floatingOrigin.toLocal(g);
    }

    // ------------------------------------------------------
    // CAMERA FRAME
    // ------------------------------------------------------

    computeCameraLocalState(cameraHeightOffset: number): CameraLocalState {
        const playerLocal = this.getPlayerLocalPosition();

        const cameraPos: Vec3 = {
            x: playerLocal.x,
            y: playerLocal.y,
            z: playerLocal.z + cameraHeightOffset
        };

        // Basic forward direction (toward horizon north)
        const forward: Vec3 = {
            x: 0,
            y: 1,
            z: 0
        };

        const up: Vec3 = {
            x: 0,
            y: 0,
            z: 1
        };

        return {
            position: cameraPos,
            forward,
            up
        };
    }

    // ------------------------------------------------------
    // RECENTER LOGIC
    // ------------------------------------------------------

    update() {
        const local = this.getPlayerLocalPosition();

        this.floatingOrigin.recenterIfNeeded(
            local,
            this.recenterThreshold
        );
    }

    setRecenterThreshold(meters: number) {
        this.recenterThreshold = meters;
    }

    // ------------------------------------------------------
    // DEBUG / UTILITIES
    // ------------------------------------------------------

    getAnchor(): Geodetic {
        return this.floatingOrigin.getAnchor();
    }

    forceRecenterToPlayer() {
        this.floatingOrigin.setAnchor(this.player.geodetic);
    }
    getCameraLocalPosition(): Vec3 {
        return this.getPlayerLocalPosition();
    }
}
