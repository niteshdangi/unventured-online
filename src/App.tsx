import { useEffect, useRef } from 'react';
import { GameEngine } from './engine';
import './App.css';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    engineRef.current = new GameEngine(canvasRef.current);
    engineRef.current.start();

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container">
      <canvas ref={canvasRef} id="game-canvas" />
    </div>
  );
}

export default App;
