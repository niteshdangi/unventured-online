import { useEffect, useRef } from 'react';
import { GameEngine } from './engine';
import './App.css';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize the engine once
    engineRef.current = new GameEngine(canvasRef.current);
    engineRef.current.start();

    return () => {
      // Cleanup on unmount
      if (engineRef.current) {
        engineRef.current.cleanup();
        engineRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container">
      <canvas ref={canvasRef} id="game-canvas" />
      <div className="ui-layer">
        <div className="instructions">
          Use WASD to move the character.
        </div>
      </div>
    </div>
  );
}

export default App;
