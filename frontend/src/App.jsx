import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Circle, Layer, Rect, Stage, Line, Text } from 'react-konva';

const DEFAULT_COLOR = '#2563eb';

const buildId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

//const socketUrl = import.meta.env.VITE_SOCKJS_URL || `${window.location.origin}/whiteboard-sockets`;
const socketUrl = 'http://localhost:8080/whiteboard-sockets';

const tools = [
  { id: 'pen', label: 'Pen' },
  { id: 'rect', label: 'Rect' },
  { id: 'circle', label: 'Circle' }
];

const createStompClient = ({ onConnect, onDisconnect }) =>
  new Client({
    reconnectDelay: 5000,
    webSocketFactory: () => new SockJS(socketUrl),
    onConnect,
    onDisconnect
  });

const safeParse = (message) => {
  if (!message?.body) {
    return null;
  }
  try {
    return JSON.parse(message.body);
  } catch (error) {
    return null;
  }
};

export default function App() {
  const stageRef = useRef(null);
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
  const [stageSize, setStageSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 120
  });
  const [drawingLineId, setDrawingLineId] = useState(null);
  const [drawingShapeId, setDrawingShapeId] = useState(null);
  const [shapeStart, setShapeStart] = useState(null);

  const linesRef = useRef(lines);
  const shapesRef = useRef(shapes);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    const updateSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight - 120
      });
    };
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const roomDestinations = useMemo(() => {
    if (!roomId) {
      return null;
    }
    return {
      appBase: `/app/rooms/${roomId}`,
      topicBase: `/topic/rooms/${roomId}`
    };
  }, [roomId]);

  useEffect(() => {
    return () => {
      stompRef.current?.deactivate();
    };
  }, []);

  const connectToRoom = () => {
    if (!roomDestinations) {
      return;
    }

    stompRef.current?.deactivate();

    const client = createStompClient({
      onConnect: () => {
        const { topicBase, appBase } = roomDestinations;

        client.subscribe(`${topicBase}/line-created`, (message) => {
          const incoming = safeParse(message);
          if (!incoming) {
            return;
          }
          setLines((prev) => {
            if (prev.some((line) => line.id === incoming.id)) {
              return prev;
            }
            return [...prev, incoming];
          });
        });

        client.subscribe(`${topicBase}/line-updated`, (message) => {
          const incoming = safeParse(message);
          if (!incoming) {
            return;
          }
          setLines((prev) =>
            prev.map((line) => (line.id === incoming.id ? incoming : line))
          );
        });

        client.subscribe(`${topicBase}/shape-created`, (message) => {
          const incoming = safeParse(message);
          if (!incoming) {
            return;
          }
          setShapes((prev) => {
            if (prev.some((shape) => shape.id === incoming.id)) {
              return prev;
            }
            return [...prev, incoming];
          });
        });

        client.subscribe(`${topicBase}/shape-updated`, (message) => {
          const incoming = safeParse(message);
          if (!incoming) {
            return;
          }
          setShapes((prev) =>
            prev.map((shape) => (shape.id === incoming.id ? incoming : shape))
          );
        });

        client.subscribe(`${topicBase}/cursor-updated`, (message) => {
          const incoming = safeParse(message);
          if (!incoming) {
            return;
          }
          setCursors((prev) => ({ ...prev, [incoming.id]: incoming }));
        });

        client.subscribe(`${topicBase}/cursor-left`, (message) => {
          const incoming = safeParse(message);
          if (!incoming?.id) {
            return;
          }
          setCursors((prev) => {
            const next = { ...prev };
            delete next[incoming.id];
            return next;
          });
        });

        client.subscribe(`${topicBase}/state-sync`, (message) => {
          const incoming = safeParse(message);
          if (incoming?.lines) {
            setLines(incoming.lines);
          }
          if (incoming?.shapes) {
            setShapes(incoming.shapes);
          }
        });

        client.subscribe(`${topicBase}/request-state`, (message) => {
          if (!message) {
            return;
          }
          client.publish({
            destination: `${appBase}/state-sync`,
            body: JSON.stringify({
              roomId,
              lines: linesRef.current,
              shapes: shapesRef.current
            })
          });
        });

        client.publish({
          destination: `${appBase}/request-state`,
          body: JSON.stringify({ roomId, requesterId: clientIdRef.current })
        });
      },
      onDisconnect: () => {
        setCursors({});
      }
    });

    stompRef.current = client;
    client.activate();
  };

  const joinRoom = () => {
    if (!roomId.trim()) {
      return;
    }
    setJoined(true);
    connectToRoom();
  };

  const publishRoomEvent = (destination, payload) => {
    if (!roomDestinations) {
      return;
    }
    const client = stompRef.current;
    if (!client || !client.connected) {
      return;
    }
    client.publish({
      destination: `${roomDestinations.appBase}/${destination}`,
      body: JSON.stringify({ ...payload, roomId })
    });
  };

  const handleMouseDown = () => {
    if (!joined) {
      return;
    }
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) {
      return;
    }

    if (tool === 'pen') {
      const line = {
        id: buildId(),
        points: [pointerPosition.x, pointerPosition.y],
        color: strokeColor,
        strokeWidth
      };
      setLines((prev) => [...prev, line]);
      setDrawingLineId(line.id);
      publishRoomEvent('line-created', line);
    }

    if (tool === 'rect' || tool === 'circle') {
      const shape = {
        id: buildId(),
        type: tool,
        x: pointerPosition.x,
        y: pointerPosition.y,
        width: 0,
        height: 0,
        radius: 0,
        color: strokeColor
      };
      setShapes((prev) => [...prev, shape]);
      setDrawingShapeId(shape.id);
      setShapeStart(pointerPosition);
      publishRoomEvent('shape-created', shape);
    }
  };

  const handleMouseMove = () => {
    if (!joined) {
      return;
    }
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) {
      return;
    }

    publishRoomEvent('cursor-updated', {
      id: clientIdRef.current,
      x: pointerPosition.x,
      y: pointerPosition.y,
      color: strokeColor
    });

    if (tool === 'pen' && drawingLineId) {
      setLines((prev) => {
        const next = prev.map((line) => {
          if (line.id !== drawingLineId) {
            return line;
          }
          const updatedLine = {
            ...line,
            points: [...line.points, pointerPosition.x, pointerPosition.y]
          };
          publishRoomEvent('line-updated', updatedLine);
          return updatedLine;
        });
        return next;
      });
    }

    if ((tool === 'rect' || tool === 'circle') && drawingShapeId && shapeStart) {
      setShapes((prev) =>
        prev.map((shape) => {
          if (shape.id !== drawingShapeId) {
            return shape;
          }
          const nextX = Math.min(shapeStart.x, pointerPosition.x);
          const nextY = Math.min(shapeStart.y, pointerPosition.y);
          const width = Math.abs(pointerPosition.x - shapeStart.x);
          const height = Math.abs(pointerPosition.y - shapeStart.y);
          const radius = Math.max(width, height) / 2;
          const updated = {
            ...shape,
            x: nextX,
            y: nextY,
            width,
            height,
            radius
          };
          publishRoomEvent('shape-updated', updated);
          return updated;
        })
      );
    }
  };

  const handleMouseUp = () => {
    setDrawingLineId(null);
    setDrawingShapeId(null);
    setShapeStart(null);
  };

  const handleMouseLeave = () => {
    publishRoomEvent('cursor-left', { id: clientIdRef.current });
  };

  const downloadPNG = () => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = `whiteboard-${roomId || 'session'}.png`;
    link.href = dataUrl;
    link.click();
  };

  const downloadJSON = () => {
    const data = {
      roomId,
      lines,
      shapes
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `whiteboard-${roomId || 'session'}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <h1>Realtime Whiteboard</h1>
          <p>Transient session • No server persistence</p>
        </div>
        <div className="room-controls">
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            disabled={joined}
          />
          <button type="button" onClick={joinRoom} disabled={joined}>
            {joined ? 'Joined' : 'Join'}
          </button>
        </div>
      </header>

      <section className="toolbar">
        <div className="tool-group">
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? 'active' : ''}
              onClick={() => setTool(item.id)}
              disabled={!joined}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="tool-group">
          <label>
            Color
            <input
              type="color"
              value={strokeColor}
              onChange={(event) => setStrokeColor(event.target.value)}
              disabled={!joined}
            />
          </label>
          <label>
            Width
            <input
              type="range"
              min="1"
              max="12"
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
              disabled={!joined}
            />
          </label>
        </div>
        <div className="tool-group">
          <button type="button" onClick={downloadPNG} disabled={!joined}>
            Export PNG
          </button>
          <button type="button" onClick={downloadJSON} disabled={!joined}>
            Export JSON
          </button>
        </div>
      </section>

      <section className="board">
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          className="stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
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
              />
            ))}
            {shapes.map((shape) =>
              shape.type === 'rect' ? (
                <Rect
                  key={shape.id}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  stroke={shape.color}
                  strokeWidth={2}
                />
              ) : (
                <Circle
                  key={shape.id}
                  x={shape.x + shape.radius}
                  y={shape.y + shape.radius}
                  radius={shape.radius}
                  stroke={shape.color}
                  strokeWidth={2}
                />
              )
            )}
            {Object.values(cursors)
              .filter((cursor) => cursor.id !== clientIdRef.current)
              .map((cursor) => (
                <React.Fragment key={cursor.id}>
                  <Circle x={cursor.x} y={cursor.y} radius={4} fill={cursor.color} />
                  <Text
                    text={cursor.id.slice(0, 4)}
                    x={cursor.x + 8}
                    y={cursor.y + 6}
                    fontSize={12}
                    fill={cursor.color}
                  />
                </React.Fragment>
              ))}
          </Layer>
        </Stage>
        {!joined && (
          <div className="overlay">
            <p>Enter a Room ID to start collaborating.</p>
          </div>
        )}
      </section>
    </div>
  );
}
