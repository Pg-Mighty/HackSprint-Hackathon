import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Circle, Layer, Rect, Stage, Line, Group } from 'react-konva';

const DEFAULT_COLOR = '#5d5dff';

const buildId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;

const tools = [
  { id: 'pen', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg> },
  { id: 'rect', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg> },
  { id: 'circle', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg> }
];

const createSocket = () =>
  io(socketUrl, {
    autoConnect: false,
    transports: ['websocket']
  });

export default function App() {
  const stageRef = useRef(null);
  const socketRef = useRef(null);
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState(DEFAULT_COLOR);
  const [strokeWidth] = useState(3);
  const [lines, setLines] = useState([]);
  const [shapes, setShapes] = useState([]);
  const [cursors, setCursors] = useState({});
  const [stageSize, setStageSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });
  const [drawingLineId, setDrawingLineId] = useState(null);
  const [drawingShapeId, setDrawingShapeId] = useState(null);
  const [shapeStart, setShapeStart] = useState(null);

  // Interaction & UI States
  const [uiVisible, setUiVisible] = useState(true);
  const [radialMenu, setRadialMenu] = useState({ visible: false, x: 0, y: 0 });
  const [lastStrokeId, setLastStrokeId] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [tbPos, setTbPos] = useState('bottom'); // 'bottom' or 'left'
  const [isTbDragging, setIsTbDragging] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState('00:00');

  const linesRef = useRef(lines);
  const shapesRef = useRef(shapes);
  const uiTimerRef = useRef(null);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // Session timer
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Global UI Visibility Tracker
  const resetUiTimer = useCallback(() => {
    setUiVisible(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = setTimeout(() => {
      setUiVisible(false);
    }, 4000); // 4 seconds before hiding
  }, []);

  useEffect(() => {
    const handleGlobalActivity = (e) => {
      // Don't hide if dragging toolbar
      resetUiTimer();
    };
    window.addEventListener('mousemove', handleGlobalActivity);
    window.addEventListener('mousedown', handleGlobalActivity);
    window.addEventListener('touchstart', handleGlobalActivity);
    resetUiTimer();
    return () => {
      window.removeEventListener('mousemove', handleGlobalActivity);
      window.removeEventListener('mousedown', handleGlobalActivity);
      window.removeEventListener('touchstart', handleGlobalActivity);
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    };
  }, [resetUiTimer]);

  // Draggable Toolbar Logic
  const handleDragStart = (e) => {
    e.preventDefault();
    setIsTbDragging(true);
    const onMove = (me) => {
      // Direct docking threshold: if mouse is far to the left, dock to left.
      if (me.clientX < 240) {
        setTbPos('left');
      } else {
        setTbPos('bottom');
      }
    };
    const onUp = () => {
      setIsTbDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const updateSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const socket = useMemo(() => {
    const instance = createSocket();
    socketRef.current = instance;
    return instance;
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleLineCreated = (inc) => setLines(prev => prev.some(l => l.id === inc.id) ? prev : [...prev, inc]);
    const handleLineUpdated = (inc) => setLines(prev => prev.map(l => l.id === inc.id ? inc : l));
    const handleShapeCreated = (inc) => setShapes(prev => prev.some(s => s.id === inc.id) ? prev : [...prev, inc]);
    const handleShapeUpdated = (inc) => setShapes(prev => prev.map(s => s.id === inc.id ? inc : s));
    const handleCursorUpdated = (inc) => setCursors(prev => ({ ...prev, [inc.id]: { ...inc, lastActive: Date.now() } }));
    const handleCursorLeft = (id) => setCursors(p => { const n = { ...p }; delete n[id]; return n; });
    const handleStateSync = (inc) => {
      if (inc?.lines) setLines(inc.lines);
      if (inc?.shapes) setShapes(inc.shapes);
    };
    const handleRequestState = () => {
      socket.emit('state-sync', { roomId, lines: linesRef.current, shapes: shapesRef.current });
    };

    socket.on('line-created', handleLineCreated);
    socket.on('line-updated', handleLineUpdated);
    socket.on('shape-created', handleShapeCreated);
    socket.on('shape-updated', handleShapeUpdated);
    socket.on('cursor-updated', handleCursorUpdated);
    socket.on('cursor-left', handleCursorLeft);
    socket.on('state-sync', handleStateSync);
    socket.on('request-state', handleRequestState);

    return () => {
      socket.off('line-created', handleLineCreated);
      socket.off('line-updated', handleLineUpdated);
      socket.off('shape-created', handleShapeCreated);
      socket.off('shape-updated', handleShapeUpdated);
      socket.off('cursor-updated', handleCursorUpdated);
      socket.off('cursor-left', handleCursorLeft);
      socket.off('state-sync', handleStateSync);
      socket.off('request-state', handleRequestState);
    };
  }, [roomId, socket]);

  const joinRoom = () => {
    if (!roomId.trim()) return;
    if (!socket.connected) socket.connect();
    socket.emit('join-room', { roomId });
    socket.emit('request-state', { roomId });
    setJoined(true);
  };

  const handleMouseDown = (e) => {
    if (!joined) return;
    // Check for left click (0)
    if (e.evt && e.evt.button !== 0) return;

    if (radialMenu.visible) {
      setRadialMenu({ visible: false, x: 0, y: 0 });
      return;
    }

    const pos = stageRef.current.getPointerPosition();
    if (!pos) return;

    if (tool === 'pen') {
      const line = { id: buildId(), points: [pos.x, pos.y], color: strokeColor, strokeWidth };
      setLines(p => [...p, line]);
      setDrawingLineId(line.id);
      socket.emit('line-created', { ...line, roomId });
    } else {
      const shape = { id: buildId(), type: tool, x: pos.x, y: pos.y, width: 0, height: 0, radius: 0, color: strokeColor };
      setShapes(p => [...p, shape]);
      setDrawingShapeId(shape.id);
      setShapeStart(pos);
      socket.emit('shape-created', { ...shape, roomId });
    }
  };

  const handleMouseMove = () => {
    if (!joined) return;
    const pos = stageRef.current.getPointerPosition();
    if (!pos) return;

    if (socket.connected) {
      socket.emit('cursor-updated', { id: socket.id, x: pos.x, y: pos.y, color: strokeColor, isDrawing: !!(drawingLineId || drawingShapeId), roomId });
    }

    if (tool === 'pen' && drawingLineId) {
      setLines(prev => prev.map(line => {
        if (line.id !== drawingLineId) return line;
        const updated = { ...line, points: [...line.points, pos.x, pos.y] };
        socket.emit('line-updated', { ...updated, roomId });
        return updated;
      }));
    } else if (drawingShapeId && shapeStart) {
      setShapes(prev => prev.map(shape => {
        if (shape.id !== drawingShapeId) return shape;
        const updated = {
          ...shape,
          x: Math.min(shapeStart.x, pos.x),
          y: Math.min(shapeStart.y, pos.y),
          width: Math.abs(pos.x - shapeStart.x),
          height: Math.abs(pos.y - shapeStart.y),
          radius: Math.max(Math.abs(pos.x - shapeStart.x), Math.abs(pos.y - shapeStart.y)) / 2
        };
        socket.emit('shape-updated', { ...updated, roomId });
        return updated;
      }));
    }
  };

  const handleMouseUp = () => {
    if (drawingLineId || drawingShapeId) {
      setLastStrokeId(drawingLineId || drawingShapeId);
      setTimeout(() => setLastStrokeId(null), 1000);
    }
    setDrawingLineId(null);
    setDrawingShapeId(null);
    setShapeStart(null);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    const pos = stageRef.current.getPointerPosition();
    setRadialMenu({ visible: true, x: pos.x, y: pos.y });
  };

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`} onContextMenu={handleContextMenu}>
      <header className={`top-bar ${!uiVisible ? 'hidden' : ''}`}>
        <div className="brand">
          <h1>Radical Board 🧬</h1>
          <div className="session-info">{elapsed}</div>
        </div>
        <div className="room-controls">
          <input type="text" placeholder="Room ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined} />
          {!joined && <button onClick={joinRoom}>Enter</button>}
        </div>
      </header>

      <div className={`toolbar position-${tbPos} ${!uiVisible && !isTbDragging ? 'hidden' : ''}`}>
        <div className="drag-handle" onMouseDown={handleDragStart}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" /></svg>
        </div>
        <div className="tool-group">
          {tools.map(t => (
            <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={t.id}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="tool-group">
          <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
          <button className="settings-toggle" onClick={() => setDarkMode(!darkMode)} title="Theme">
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {radialMenu.visible && (
        <div className="radial-menu" style={{ left: radialMenu.x, top: radialMenu.y }}>
          {tools.map((t, i) => {
            const angle = (i / tools.length) * 2 * Math.PI - Math.PI / 2;
            const dist = 60;
            return (
              <div key={t.id} className="radial-item" style={{ transform: `translate(${Math.cos(angle) * dist - 24}px, ${Math.sin(angle) * dist - 24}px)` }} onClick={() => { setTool(t.id); setRadialMenu({ ...radialMenu, visible: false }); }}>
                {t.icon}
              </div>
            );
          })}
        </div>
      )}

      <main className="board">
        <Stage ref={stageRef} width={stageSize.width} height={stageSize.height} className="stage" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => socket.connected && socket.emit('cursor-left', socket.id)} onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}>
          <Layer>
            {lines.map(line => (
              <Line key={line.id} points={line.points} stroke={line.color} strokeWidth={line.strokeWidth} tension={0.5} lineCap="round" lineJoin="round" shadowColor={lastStrokeId === line.id ? line.color : 'transparent'} shadowBlur={lastStrokeId === line.id ? 20 : 0} shadowOpacity={lastStrokeId === line.id ? 0.8 : 0} />
            ))}
            {shapes.map(shape => {
              const cp = { key: shape.id, stroke: shape.color, strokeWidth: 2, shadowColor: lastStrokeId === shape.id ? shape.color : 'transparent', shadowBlur: lastStrokeId === shape.id ? 20 : 0, shadowOpacity: lastStrokeId === shape.id ? 0.8 : 0 };
              return shape.type === 'rect' ? <Rect {...cp} x={shape.x} y={shape.y} width={shape.width} height={shape.height} /> : <Circle {...cp} x={shape.x + shape.radius} y={shape.y + shape.radius} radius={shape.radius} />;
            })}
            {Object.values(cursors).map(c => (
              <Group key={c.id}>
                <Circle x={c.x} y={c.y} radius={c.isDrawing ? 16 : 10} fill={c.color} opacity={0.15} />
                <Circle x={c.x} y={c.y} radius={c.isDrawing ? 10 : 6} fill={c.color} opacity={0.3} />
                <Circle x={c.x} y={c.y} radius={c.isDrawing ? 4 : 3} fill={c.color} />
              </Group>
            ))}
          </Layer>
        </Stage>
        {!joined && <div className="overlay"><p>Ready to manifest? Enter a Room ID.</p></div>}
      </main>
    </div>
  );
}
