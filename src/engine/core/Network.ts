import * as THREE from 'three';
import { Player } from '../world/Player';

interface NetworkPlayer {
    id: string;
    mesh: THREE.Mesh;
    targetPosition: THREE.Vector3;
    currentPosition: THREE.Vector3;
}

export class NetworkManager {
    private socket: WebSocket | null = null;
    private clientId: string | null = null;
    private otherPlayers: Map<string, NetworkPlayer> = new Map();
    private scene: THREE.Scene;

    // A flag to check if the connection is active
    public isConnected = false;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public connect(url: string = 'ws://localhost:3001') {
        try {
            this.socket = new WebSocket(url);

            this.socket.onopen = () => {
                console.log("[Network] Connected to MMO server.");
                this.isConnected = true;
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.socket.onclose = () => {
                console.log("[Network] Disconnected from server.");
                this.isConnected = false;
            };

            this.socket.onerror = (error) => {
                console.error("[Network] WebSocket Error:", error);
            };
        } catch (e) {
            console.warn("Failed to connect to network. Running in single-player mode.", e);
        }
    }

    private handleMessage(data: any) {
        switch (data.type) {
            case 'welcome':
                this.clientId = data.id;
                console.log("[Network] Assigned Client ID:", this.clientId);
                // Also load existing players
                break;
            case 'playerJoined':
                this.spawnRemotePlayer(data.id, data.position);
                break;
            case 'playerLeft':
                this.removeRemotePlayer(data.id);
                break;
            case 'stateUpdate':
                this.syncWorldState(data.players);
                break;
        }
    }

    private spawnRemotePlayer(id: string, startPos: { x: number, y: number, z: number }) {
        if (id === this.clientId || this.otherPlayers.has(id)) return;

        // Basic blue box for other players
        const geo = new THREE.BoxGeometry(1, 2, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x4444ff });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set(startPos.x, startPos.y, startPos.z);
        mesh.castShadow = true;

        this.scene.add(mesh);

        this.otherPlayers.set(id, {
            id,
            mesh,
            currentPosition: mesh.position.clone(),
            targetPosition: mesh.position.clone()
        });

        console.log(`[Network] Player ${id} joined.`);
    }

    private removeRemotePlayer(id: string) {
        const player = this.otherPlayers.get(id);
        if (player) {
            this.scene.remove(player.mesh);
            player.mesh.geometry.dispose();
            (player.mesh.material as THREE.Material).dispose();
            this.otherPlayers.delete(id);
            console.log(`[Network] Player ${id} left.`);
        }
    }

    private syncWorldState(playerStates: any[]) {
        for (const state of playerStates) {
            // Ignore our own state
            if (state.id === this.clientId) continue;

            let remotePlayer = this.otherPlayers.get(state.id);
            if (!remotePlayer) {
                // If we don't know them, spawn them
                this.spawnRemotePlayer(state.id, state.position);
                remotePlayer = this.otherPlayers.get(state.id);
            }

            if (remotePlayer) {
                // Update their TARGET position for interpolation
                remotePlayer.targetPosition.set(state.position.x, state.position.y, state.position.z);
            }
        }
    }

    // Called by the Engine loop to send our local state to the server
    public broadcastLocalState(player: Player) {
        if (!this.isConnected || !this.socket || !this.clientId) return;

        const pos = player.getPosition();

        this.socket.send(JSON.stringify({
            type: 'move',
            position: { x: pos.x, y: pos.y, z: pos.z }
        }));
    }

    // Called by the Engine loop to smoothly move remote players
    public updateInterpolation(delta: number) {
        for (const [, player] of this.otherPlayers) {
            // Entity Interpolation: smoothly Lerp from current position to target target position
            // sent by the server. 10 is the lerp speed factor.
            player.mesh.position.lerp(player.targetPosition, 10 * delta);
        }
    }
}
