import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Circle, Layer, Rect, Stage, Line, Group, Transformer } from 'react-konva';

const DEFAULT_COLOR = '#5d5dff';

const buildId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const socketUrl = 'http://localhost:8080/whiteboard-sockets';

const tools = [
  { id: 'select', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l3.057 14.943L12 12l5 5 2-2-5-5 5.057-3.943z" /></svg> },
  { id: 'pen', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg> },
  { id: 'rect', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg> },
  { id: 'circle', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg> }
];

const createStompClient = ({ onConnect, onDisconnect }) =>
  new Client({
    reconnectDelay: 5000,
    webSocketFactory: () => new SockJS(socketUrl),
    onConnect,
    onDisconnect
  });

const safeParse = (message) => {
  if (!message?.body) return null;
  try { return JSON.parse(message.body); } catch (e) { return null; }
};

export default function App() {
  const stageRef = useRef(null);
  const transformerRef = useRef(null);
  const stompRef = useRef(null);
  const clientIdRef = useRef(buildId());

  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [lines, setLines] = useState([]);
  const [shapes, setShapes] = useState([]);
  const [cursors, setCursors] = useState({});
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const [drawingLineId, setDrawingLineId] = useState(null);
  const [drawingShapeId, setDrawingShapeId] = useState(null);
  const [shapeStart, setShapeStart] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // Interaction & UI States
  const [uiVisible, setUiVisible] = useState(true);
  const [radialMenu, setRadialMenu] = useState({ visible: false, x: 0, y: 0 });
  const [lastStrokeId, setLastStrokeId] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [tbPos, setTbPos] = useState('bottom');
  const [isTbDragging, setIsTbDragging] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState('00:00');

  const linesRef = useRef(lines);
  const shapesRef = useRef(shapes);
  const uiTimerRef = useRef(null);
  const idleTimerRef = useRef(null);

  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);

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

  // UI Visibility & Idle Logic
  const resetUiTimer = useCallback(() => {
    setUiVisible(true);
    setIsIdle(false);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    uiTimerRef.current = setTimeout(() => {
      if (!drawingLineId && !drawingShapeId) setUiVisible(false);
    }, 4000);

    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 10000);
  }, [drawingLineId, drawingShapeId]);

  useEffect(() => {
    const handleGlobalActivity = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
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
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetUiTimer]);

  // Drift Calculation
  const driftStyle = useMemo(() => {
    if (tbPos !== 'bottom') return {};
    const centerX = window.innerWidth / 2;
    const offsetX = (mousePos.x - centerX) * 0.03;
    return { left: `calc(50% + ${offsetX}px)`, transform: 'translateX(-50%)' };
  }, [mousePos.x, tbPos]);

  // STOMP Logic
  const roomDestinations = useMemo(() => {
    if (!roomId) return null;
    return { appBase: `/app/rooms/${roomId}`, topicBase: `/topic/rooms/${roomId}` };
  }, [roomId]);

  const connectToRoom = () => {
    if (!roomDestinations) return;
    stompRef.current?.deactivate();

    const client = createStompClient({
      onConnect: () => {
        const { topicBase, appBase } = roomDestinations;

        client.subscribe(`${topicBase}/line-created`, (m) => {
          const inc = safeParse(m);
          if (inc) setLines(prev => prev.some(l => l.id === inc.id) ? prev : [...prev, inc]);
        });

        client.subscribe(`${topicBase}/line-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setLines(prev => prev.map(l => (l.id === inc.id ? inc : l)));
        });

        client.subscribe(`${topicBase}/shape-created`, (m) => {
          const inc = safeParse(m);
          if (inc) setShapes(prev => prev.some(s => s.id === inc.id) ? prev : [...prev, inc]);
        });

        client.subscribe(`${topicBase}/shape-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setShapes(prev => prev.map(s => (s.id === inc.id ? inc : s)));
        });

        client.subscribe(`${topicBase}/cursor-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setCursors(prev => ({ ...prev, [inc.id]: inc }));
        });

        client.subscribe(`${topicBase}/cursor-left`, (m) => {
          const inc = safeParse(m);
          if (inc?.id) setCursors(prev => { const n = { ...prev }; delete n[inc.id]; return n; });
        });

        client.subscribe(`${topicBase}/state-sync`, (m) => {
          const inc = safeParse(m);
          if (inc?.lines) setLines(inc.lines);
          if (inc?.shapes) setShapes(inc.shapes);
        });

        client.subscribe(`${topicBase}/request-state`, () => {
          client.publish({
            destination: `${appBase}/state-sync`,
            body: JSON.stringify({ roomId, lines: linesRef.current, shapes: shapesRef.current })
          });
        });

        client.publish({
          destination: `${appBase}/request-state`,
          body: JSON.stringify({ roomId, requesterId: clientIdRef.current })
        });
      },
      onDisconnect: () => setCursors({})
    });

    stompRef.current = client;
    client.activate();
  };

  const publishRoomEvent = (destination, payload) => {
    if (!roomDestinations || !stompRef.current?.connected) return;
    stompRef.current.publish({
      destination: `${roomDestinations.appBase}/${destination}`,
      body: JSON.stringify({ ...payload, roomId })
    });
  };

  const joinRoom = () => {
    if (!roomId.trim()) return;
    setJoined(true);
    connectToRoom();
  };

  const handleDragStart = (e) => {
    e.preventDefault();
    setIsTbDragging(true);
    const onMove = (me) => {
      if (me.clientX < 240) setTbPos('left');
      else setTbPos('bottom');
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
    const updateSize = () => setStageSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleMouseDown = (e) => {
    if (!joined || (e.evt && e.evt.button !== 0)) return;
    if (radialMenu.visible) { setRadialMenu({ visible: false, x: 0, y: 0 }); return; }

    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) setSelectedId(null);
    if (tool === 'select') {
      if (!clickedOnEmpty) setSelectedId(e.target.id());
      return;
    }

    const stage = stageRef.current;
    const pointer = stage.getPointerPosition();
    const pos = { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() };

    if (tool === 'pen') {
      const line = { id: buildId(), points: [pos.x, pos.y], color: strokeColor, strokeWidth };
      setLines(p => [...p, line]);
      setDrawingLineId(line.id);
      publishRoomEvent('line-created', line);
    } else if (tool === 'rect') {
      const shape = { id: buildId(), type: 'rect', x: pos.x, y: pos.y, width: 0, height: 0, color: strokeColor, scaleX: 1, scaleY: 1, rotation: 0 };
      setShapes(p => [...p, shape]);
      setDrawingShapeId(shape.id);
      setShapeStart(pos);
      publishRoomEvent('shape-created', shape);
    } else if (tool === 'circle') {
      const shape = { id: buildId(), type: 'circle', x: pos.x, y: pos.y, radius: 0, color: strokeColor, scaleX: 1, scaleY: 1, rotation: 0 };
      setShapes(p => [...p, shape]);
      setDrawingShapeId(shape.id);
      setShapeStart(pos);
      publishRoomEvent('shape-created', shape);
    }
  };

  const handleMouseMove = () => {
    if (!joined) return;
    const stage = stageRef.current;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const pos = { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() };

    publishRoomEvent('cursor-updated', { id: clientIdRef.current, x: pos.x, y: pos.y, color: strokeColor });

    if (tool === 'pen' && drawingLineId) {
      setLines((prev) => prev.map((line) => {
        if (line.id !== drawingLineId) return line;
        const updated = { ...line, points: [...line.points, pos.x, pos.y] };
        publishRoomEvent('line-updated', updated);
        return updated;
      }));
    } else if (drawingShapeId && shapeStart) {
      setShapes((prev) => prev.map((shape) => {
        if (shape.id !== drawingShapeId) return shape;
        if (shape.type === 'rect') {
          return {
            ...shape,
            x: Math.min(shapeStart.x, pos.x), y: Math.min(shapeStart.y, pos.y),
            width: Math.abs(pos.x - shapeStart.x), height: Math.abs(pos.y - shapeStart.y)
          };
        } else {
          // Circle: calculate radius from start to current
          const radius = Math.sqrt(Math.pow(pos.x - shapeStart.x, 2) + Math.pow(pos.y - shapeStart.y, 2));
          return { ...shape, radius };
        }
      }));
      const updated = shapesRef.current.find(s => s.id === drawingShapeId);
      if (updated) publishRoomEvent('shape-updated', updated);
    }
  };

  const handleMouseUp = () => {
    if (drawingLineId || drawingShapeId) {
      setLastStrokeId(drawingLineId || drawingShapeId);
      setTimeout(() => setLastStrokeId(null), 1200);
    }
    setDrawingLineId(null);
    setDrawingShapeId(null);
    setShapeStart(null);
  };

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const speed = 0.05;
    const newScale = e.evt.deltaY > 0 ? oldScale / (1 + speed) : oldScale * (1 + speed);
    stage.scale({ x: newScale, y: newScale });
    stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    setShapes(prev => {
      const next = prev.map(s => s.id !== node.id() ? s : {
        ...s,
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation()
      });
      const updated = next.find(s => s.id === node.id());
      if (updated) publishRoomEvent('shape-updated', updated);
      return next;
    });
  };

  useEffect(() => {
    if (selectedId && transformerRef.current) {
      const selectedNode = stageRef.current.findOne('#' + selectedId);
      transformerRef.current.nodes(selectedNode ? [selectedNode] : []);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedId]);

  const handleMouseLeave = () => {
    publishRoomEvent('cursor-left', { id: clientIdRef.current });
  };

  return (
    <div className={`app ${darkMode ? 'dark' : ''} ${isIdle ? 'idle' : ''}`} onContextMenu={(e) => { e.preventDefault(); const p = stageRef.current.getPointerPosition(); if (p) setRadialMenu({ visible: true, x: p.x, y: p.y }); }}>
      <header className={`ui-atom top-bar ${(!uiVisible || !!drawingLineId || !!drawingShapeId) ? 'hidden' : ''}`}>
        <div className="brand">
          <div className="pulse-dot" />
          <h1 style={{ color: 'var(--ink-color)' }}>Radical Board</h1>
          <div className="session-info" style={{ color: 'var(--accent-color)' }}>Live for {elapsed} <span className="ephemerality-tag">· Not saved</span></div>
        </div>
        <div className="room-controls">
          <input type="text" placeholder="Summon ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined} />
          {!joined && <button onClick={joinRoom}>Manifest</button>}
        </div>
      </header>

      <div
        className={`ui-atom toolbar position-${tbPos} ${(!uiVisible || !!drawingLineId || !!drawingShapeId) && !isTbDragging ? 'hidden' : ''}`}
        style={driftStyle}
      >
        <div className="drag-handle" onMouseDown={handleDragStart}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="19" r="1.5" /></svg>
        </div>
        <div className="tool-group">
          {tools.map(t => (
            <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => { setTool(t.id); if (t.id !== 'select') setSelectedId(null); }} title={t.id}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="tool-group">
          <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} disabled={!joined} />
          <label>
            <input type="range" min="1" max="15" value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} disabled={!joined} />
          </label>
          <button className="settings-toggle" onClick={() => setDarkMode(!darkMode)} title="Theme">
            {darkMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
        </div>
      </div>

      {radialMenu.visible && (
        <div className="radial-menu" style={{ left: radialMenu.x, top: radialMenu.y }}>
          {tools.map((t, i) => {
            const angle = (i / tools.length) * 2 * Math.PI - Math.PI / 2;
            return <div key={t.id} className="radial-item" style={{ transform: `translate(${Math.cos(angle) * 75 - 26}px, ${Math.sin(angle) * 75 - 26}px)` }} onClick={() => { setTool(t.id); if (t.id !== 'select') setSelectedId(null); setRadialMenu({ visible: false, x: 0, y: 0 }); }}>{t.icon}</div>;
          })}
        </div>
      )}

      <main className="board">
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          className="stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
        >
          <Layer>
            {lines.map((line) => (
              <Line
                key={line.id}
                points={line.points}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                shadowColor={lastStrokeId === line.id ? line.color : 'transparent'}
                shadowBlur={lastStrokeId === line.id ? 40 : 0}
                opacity={lastStrokeId === line.id ? 1 : 0.9}
              />
            ))}
            {shapes.map((s) => {
              const cp = { id: s.id, key: s.id, stroke: s.color, strokeWidth: 2, shadowColor: lastStrokeId === s.id ? s.color : 'transparent', shadowBlur: 40, shadowOpacity: lastStrokeId === s.id ? 1 : 0, draggable: tool === 'select', onTransformEnd: handleTransformEnd, onDragEnd: handleTransformEnd, scaleX: s.scaleX || 1, scaleY: s.scaleY || 1, rotation: s.rotation || 0 };
              return s.type === 'rect' ? (
                <Rect {...cp} x={s.x} y={s.y} width={s.width} height={s.height} />
              ) : (
                <Circle {...cp} x={s.x} y={s.y} radius={s.radius} />
              );
            })}
            {selectedId && (
              <Transformer
                ref={transformerRef}
                rotateEnabled={true}
                flipEnabled={false}
                borderStroke="#5d5dff"
                borderDash={[4, 4]}
                anchorFill="#fff"
                anchorStroke="#5d5dff"
                anchorCornerRadius={3}
              />
            )}
            {Object.values(cursors).filter(c => c.id !== clientIdRef.current).map((c) => (
              <Group key={c.id}>
                <Circle x={c.x} y={c.y} radius={14} fill={c.color} opacity={0.08} />
                <Circle x={c.x} y={c.y} radius={8} fill={c.color} opacity={0.18} />
                <Circle x={c.x} y={c.y} radius={4} fill={c.color} />
              </Group>
            ))}
          </Layer>
        </Stage>
        {!joined && <div className="overlay"><p>Move your cursor to manifest the surface.</p></div>}
      </main>
    </div>
  );
}
