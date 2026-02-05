import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Circle, Layer, Rect, Stage, Line, Group, Transformer, Image } from 'react-konva';

const DEFAULT_COLOR = '#5d5dff';

const buildId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const useImage = (src) => {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!src) return;
    const image = new window.Image();
    image.src = src;
    image.onload = () => setImg(image);
  }, [src]);
  return [img];
};

const socketUrl = 'http://localhost:8080/whiteboard-sockets';

const tools = [
  { id: 'select', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l3.057 14.943L12 12l5 5 2-2-5-5 5.057-3.943z" /></svg> },
  { id: 'pen', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg> },
  { id: 'eraser', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z" /><path d="M6 11L13 18" /></svg> },
  { id: 'rect', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg> },
  { id: 'circle', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg> }
];

const palette = [
  { name: 'Ink', color: '#1a1a1a' },
  { name: 'Slate', color: '#64748b' },
  { name: 'Manifest', color: '#5d5dff' },
  { name: 'Teal', color: '#0d9488' },
  { name: 'Forest', color: '#16a34a' },
  { name: 'Ember', color: '#ea580c' },
  { name: 'Rose', color: '#dc2626' }
];

const URLImage = ({ image, onTransform, tool }) => {
  const [img] = useImage(image.src);
  return (
    <Image
      image={img}
      id={image.id}
      name={image.id}
      x={image.x}
      y={image.y}
      width={image.width}
      height={image.height}
      scaleX={image.scaleX}
      scaleY={image.scaleY}
      rotation={image.rotation}
      draggable={tool === 'select'}
      onTransformEnd={onTransform}
      onDragEnd={onTransform}
    />
  );
};

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
  const [images, setImages] = useState([]);
  const [cursors, setCursors] = useState({});
  const [history, setHistory] = useState([{ lines: [], shapes: [], images: [] }]);
  const [historyStep, setHistoryStep] = useState(0);
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
  const [showAdvancedPicker, setShowAdvancedPicker] = useState(false);
  const colorInputRef = useRef(null);

  const linesRef = useRef(lines);
  const shapesRef = useRef(shapes);
  const imagesRef = useRef(images);
  const uiTimerRef = useRef(null);
  const idleTimerRef = useRef(null);

  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { imagesRef.current = images; }, [images]);

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

  // STOMP Logic & Destinations
  const roomDestinations = useMemo(() => {
    if (!roomId) return null;
    return { appBase: `/app/rooms/${roomId}`, topicBase: `/topic/rooms/${roomId}` };
  }, [roomId]);

  const publishRoomEvent = useCallback((destination, payload) => {
    if (!roomDestinations || !stompRef.current?.connected) return;
    stompRef.current.publish({
      destination: `${roomDestinations.appBase}/${destination}`,
      body: JSON.stringify({ ...payload, roomId })
    });
  }, [roomDestinations, roomId, stompRef.current?.connected]);

  const removeElement = useCallback((id) => {
    setLines(prev => {
      const filtered = prev.filter(l => l.id !== id);
      if (filtered.length !== prev.length) publishRoomEvent('line-removed', { id });
      return filtered;
    });
    setShapes(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length !== prev.length) publishRoomEvent('shape-removed', { id });
      return filtered;
    });
    setImages(prev => {
      const filtered = prev.filter(i => i.id !== id);
      if (filtered.length !== prev.length) publishRoomEvent('image-removed', { id });
      return filtered;
    });
    saveHistory();
  }, [publishRoomEvent]);

  const saveHistory = useCallback(() => {
    const newState = { lines: linesRef.current, shapes: shapesRef.current, images: imagesRef.current };
    setHistory(prev => {
      const newHistory = prev.slice(0, historyStep + 1);
      return [...newHistory, newState];
    });
    setHistoryStep(prev => prev + 1);
  }, [historyStep]);

  const undo = useCallback(() => {
    if (historyStep === 0) return;
    const newStep = historyStep - 1;
    const prevState = history[newStep];
    setLines(prevState.lines);
    setShapes(prevState.shapes);
    setImages(prevState.images);
    setHistoryStep(newStep);
    publishRoomEvent('state-sync', { lines: prevState.lines, shapes: prevState.shapes, images: prevState.images });
  }, [history, historyStep, publishRoomEvent]);

  const redo = useCallback(() => {
    if (historyStep === history.length - 1) return;
    const newStep = historyStep + 1;
    const nextState = history[newStep];
    setLines(nextState.lines);
    setShapes(nextState.shapes);
    setImages(nextState.images);
    setHistoryStep(newStep);
    publishRoomEvent('state-sync', { lines: nextState.lines, shapes: nextState.shapes, images: nextState.images });
  }, [history, historyStep, publishRoomEvent]);

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
      if (e.clientX && e.clientY) setMousePos({ x: e.clientX, y: e.clientY });
      resetUiTimer();
    };
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        removeElement(selectedId);
        setSelectedId(null);
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
      }
    };

    const handlePaste = (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            const pos = stageRef.current.getPointerPosition() || { x: 100, y: 100 };
            const img = {
              id: buildId(),
              src: event.target.result,
              x: pos.x,
              y: pos.y,
              width: 300,
              height: 200,
              scaleX: 1,
              scaleY: 1,
              rotation: 0
            };
            setImages(prev => [...prev, img]);
            publishRoomEvent('image-created', img);
            saveHistory();
          };
          reader.readAsDataURL(blob);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleGlobalActivity);
    window.addEventListener('mousedown', handleGlobalActivity);
    window.addEventListener('touchstart', handleGlobalActivity);
    window.addEventListener('paste', handlePaste);
    resetUiTimer();
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleGlobalActivity);
      window.removeEventListener('mousedown', handleGlobalActivity);
      window.removeEventListener('touchstart', handleGlobalActivity);
      window.removeEventListener('paste', handlePaste);
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetUiTimer, selectedId, removeElement, undo, redo]);

  // Magnet Drag Style
  const driftStyle = useMemo(() => {
    if (isTbDragging) {
      return {
        left: `${mousePos.x}px`,
        top: `${mousePos.y}px`,
        transform: 'translate(-50%, -50%)',
        transition: 'none', // Snap to mouse instantly while dragging
        cursor: 'grabbing'
      };
    }
    if (tbPos !== 'bottom') return {};
    const centerX = window.innerWidth / 2;
    const offsetX = (mousePos.x - centerX) * 0.03;
    return { left: `calc(50% + ${offsetX}px)`, transform: 'translateX(-50%)' };
  }, [mousePos.x, mousePos.y, tbPos, isTbDragging]);

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

        client.subscribe(`${topicBase}/line-removed`, (m) => {
          const inc = safeParse(m);
          if (inc?.id) setLines(prev => prev.filter(l => l.id !== inc.id));
        });

        client.subscribe(`${topicBase}/shape-created`, (m) => {
          const inc = safeParse(m);
          if (inc) setShapes(prev => prev.some(s => s.id === inc.id) ? prev : [...prev, inc]);
        });

        client.subscribe(`${topicBase}/shape-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setShapes(prev => prev.map(s => (s.id === inc.id ? inc : s)));
        });

        client.subscribe(`${topicBase}/shape-removed`, (m) => {
          const inc = safeParse(m);
          if (inc?.id) setShapes(prev => prev.filter(s => s.id !== inc.id));
        });

        client.subscribe(`${topicBase}/cursor-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setCursors(prev => ({ ...prev, [inc.id]: inc }));
        });

        client.subscribe(`${topicBase}/cursor-left`, (m) => {
          const inc = safeParse(m);
          if (inc?.id) setCursors(prev => { const n = { ...prev }; delete n[inc.id]; return n; });
        });

        client.subscribe(`${topicBase}/image-created`, (m) => {
          const inc = safeParse(m);
          if (inc) setImages(prev => prev.some(i => i.id === inc.id) ? prev : [...prev, inc]);
        });

        client.subscribe(`${topicBase}/image-updated`, (m) => {
          const inc = safeParse(m);
          if (inc) setImages(prev => prev.map(i => (i.id === inc.id ? inc : i)));
        });

        client.subscribe(`${topicBase}/image-removed`, (m) => {
          const inc = safeParse(m);
          if (inc?.id) setImages(prev => prev.filter(i => i.id !== inc.id));
        });

        client.subscribe(`${topicBase}/state-sync`, (m) => {
          const inc = safeParse(m);
          if (inc?.lines) setLines(inc.lines);
          if (inc?.shapes) setShapes(inc.shapes);
          if (inc?.images) setImages(inc.images);
        });

        client.subscribe(`${topicBase}/request-state`, () => {
          client.publish({
            destination: `${appBase}/state-sync`,
            body: JSON.stringify({ roomId, lines: linesRef.current, shapes: shapesRef.current, images: imagesRef.current })
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

  const joinRoom = () => {
    if (!roomId.trim()) return;
    setJoined(true);
    connectToRoom();
  };

  const handleDragStart = (e) => {
    e.preventDefault();
    setIsTbDragging(true);
    const onMove = (me) => {
      setMousePos({ x: me.clientX, y: me.clientY }); // Keep mousePos updated for the magnet effect
      if (me.clientX < 150) setTbPos('left');
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
    const clickedOnEmpty = e.target === e.target.getStage();

    if (tool === 'select') {
      if (clickedOnEmpty) {
        setSelectedId(null);
      } else {
        const name = e.target.name();
        // Allow selecting shapes, lines, and images
        if (shapes.some(s => s.id === name) || lines.some(l => l.id === name) || images.some(i => i.id === name)) {
          setSelectedId(name);
        }
      }
      return;
    }

    if (tool === 'eraser') {
      if (!clickedOnEmpty) {
        removeElement(e.target.name() || e.target.id());
      }
      return;
    }

    if (!joined || (e.evt && e.evt.button !== 0)) return;
    if (radialMenu.visible) { setRadialMenu({ visible: false, x: 0, y: 0 }); return; }

    if (clickedOnEmpty) setSelectedId(null);

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
      saveHistory(); // Save after finished drawing
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
    const updateState = (setter, list, eventName) => {
      setter(prev => {
        const next = prev.map(item => item.id !== node.id() ? item : {
          ...item,
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: node.rotation()
        });
        const updated = next.find(i => i.id === node.id());
        if (updated) publishRoomEvent(eventName, updated);
        return next;
      });
    };

    if (shapes.some(s => s.id === node.id())) {
      updateState(setShapes, shapes, 'shape-updated');
    } else if (lines.some(l => l.id === node.id())) {
      updateState(setLines, lines, 'line-updated');
    } else if (images.some(i => i.id === node.id())) {
      updateState(setImages, images, 'image-updated');
    }
    saveHistory(); // Save after transformation
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
        className={`ui-atom toolbar position-${tbPos} ${isTbDragging ? 'dragging' : ''} ${(!uiVisible || !!drawingLineId || !!drawingShapeId) && !isTbDragging ? 'hidden' : ''}`}
        style={driftStyle}
      >
        <div className="drag-handle" onMouseDown={handleDragStart}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></svg>
        </div>
        <div className="tool-group">
          {tools.map(t => (
            <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => { setTool(t.id); if (t.id !== 'select') setSelectedId(null); }} title={t.id}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="tool-group palette">
          {palette.map(p => (
            <div
              key={p.color}
              className={`ink-dot ${strokeColor === p.color ? 'active' : ''}`}
              style={{ '--dot-color': p.color }}
              onClick={() => { setStrokeColor(p.color); setShowAdvancedPicker(false); }}
              title={p.name}
            />
          ))}
          <div className="advanced-trigger" onClick={() => colorInputRef.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <input
              ref={colorInputRef}
              type="color"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', border: 'none' }}
            />
          </div>
          <div className="width-adjuster">
            <input
              type="range"
              min="1"
              max="15"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              disabled={!joined}
              style={{ '--active-color': strokeColor }}
            />
          </div>
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
          className={`stage cursor-${tool}`}
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
                id={line.id}
                name={line.id}
                points={line.points}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                hitStrokeWidth={20}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                draggable={tool === 'select'}
                onTransformEnd={handleTransformEnd}
                onDragEnd={handleTransformEnd}
                x={line.x || 0}
                y={line.y || 0}
                scaleX={line.scaleX || 1}
                scaleY={line.scaleY || 1}
                rotation={line.rotation || 0}
                shadowColor={lastStrokeId === line.id ? line.color : 'transparent'}
                shadowBlur={lastStrokeId === line.id ? 40 : 0}
                opacity={lastStrokeId === line.id ? 1 : 0.9}
              />
            ))}
            {images.map((img) => (
              <URLImage
                key={img.id}
                image={img}
                tool={tool}
                onTransform={handleTransformEnd}
              />
            ))}
            {shapes.map((s) => {
              const cp = { id: s.id, name: s.id, key: s.id, stroke: s.color, strokeWidth: 2, strokeScaleEnabled: false, shadowColor: lastStrokeId === s.id ? s.color : 'transparent', shadowBlur: 40, shadowOpacity: lastStrokeId === s.id ? 1 : 0, draggable: tool === 'select', onTransformEnd: handleTransformEnd, onDragEnd: handleTransformEnd, scaleX: s.scaleX || 1, scaleY: s.scaleY || 1, rotation: s.rotation || 0 };
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
                borderStroke={darkMode ? '#8181ff' : '#5d5dff'}
                borderDash={[6, 4]}
                borderStrokeWidth={1}
                anchorFill={darkMode ? '#8181ff' : '#5d5dff'}
                anchorStroke={darkMode ? '#ffffff' : '#5d5dff'}
                anchorCornerRadius={4}
                anchorSize={9}
                anchorStrokeWidth={1.5}
                padding={5}
                keepRatio={false}
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
