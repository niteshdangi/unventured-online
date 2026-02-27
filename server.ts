import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';

const port = 3001;
const wss = new WebSocketServer({ port });

interface Vector3 {
    x: number;
    y: number;
    z: number;
}

interface PlayerState {
    id: string;
    position: Vector3;
}

const players = new Map<string, PlayerState>();
const clients = new Map<string, WebSocket>();

wss.on('connection', (ws: WebSocket) => {
    // Generate a unique ID for the new player
    const id = crypto.randomUUID();

    // Spawn at 0, 50, 0 so they fall to terrain
    const initialPosition = { x: 0, y: 50, z: 0 };

    players.set(id, { id, position: initialPosition });
    clients.set(id, ws);

    console.log(`[Server] Player ${id} connected. Total players: ${players.size}`);

    // Send a welcome message with their ID
    ws.send(JSON.stringify({
        type: 'welcome',
        id
    }));

    // Tell everyone else about the new player
    const spawnMessage = JSON.stringify({
        type: 'playerJoined',
        id,
        position: initialPosition
    });

    clients.forEach((client, clientId) => {
        if (clientId !== id && client.readyState === WebSocket.OPEN) {
            client.send(spawnMessage);
        }
    });

    // Handle incoming messages
    ws.on('message', (message: string) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'move' && data.position) {
                // Update player position in our state map
                const player = players.get(id);
                if (player) {
                    player.position = data.position;
                }
            }
        } catch (e) {
            console.error("Failed to parse message", e);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log(`[Server] Player ${id} disconnected.`);
        players.delete(id);
        clients.delete(id);

        // Notify others
        const leaveMessage = JSON.stringify({
            type: 'playerLeft',
            id
        });

        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(leaveMessage);
            }
        });
    });
});

// Broadcast state loop (Tick Rate = 20Hz / 50ms)
setInterval(() => {
    const playerStates = Array.from(players.values());

    if (playerStates.length === 0) return;

    const stateMessage = JSON.stringify({
        type: 'stateUpdate',
        players: playerStates
    });

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(stateMessage);
        }
    });
}, 50);

console.log(`[Server] MMO WebSocket server running on ws://localhost:${port}`);
