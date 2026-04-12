/**
 * GraphCanvas.jsx
 * D3 force-directed graph rendered to HTML5 Canvas.
 * Supports human, agent, robot, cron nodes with distinct visuals.
 */

import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { actorColor } from '../../api/graphApi';

const ACTOR_RING = {
  human:  null,        // no ring
  agent:  '#7F77DD',
  robot:  '#D85A30',
  cron:   '#BA7517',
};

export default function GraphCanvas({ nodes, links, onNodeClick, onNodeDragEnd, width, height }) {
  const canvasRef = useRef(null);
  const simRef    = useRef(null);
  const nodesRef  = useRef([]);
  const linksRef  = useRef([]);
  const dragging  = useRef(null);
  const transform = useRef({ x: 0, y: 0, k: 1 });

  // ---------------------------------------------------------------
  // Init / update simulation
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!nodes.length) return;

    // Clone so D3 can mutate
    nodesRef.current = nodes.map(n => ({ ...n, _r: nodeRadius(n) }));
    linksRef.current = links.map(l => ({ ...l }));

    // Kill old sim
    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation(nodesRef.current)
      .force('link', d3.forceLink(linksRef.current)
        .id(d => d.id)
        .distance(d => 80 + (1 - (d.value || 0.5)) * 60)
        .strength(0.4)
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d._r + 4))
      .alphaDecay(0.03)
      .on('tick', render);

    simRef.current = sim;
    return () => sim.stop();
  }, [nodes, links, width, height]);

  // ---------------------------------------------------------------
  // Render frame
  // ---------------------------------------------------------------
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { x, y, k } = transform.current;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Draw links
    linksRef.current.forEach(link => {
      const s = link.source, t = link.target;
      if (!s?.x || !t?.x) return;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      const alpha = Math.max(0.08, (link.value || 0.5) * 0.4);
      ctx.strokeStyle = `rgba(180,170,220,${alpha})`;
      ctx.lineWidth = 1 / k;
      ctx.stroke();
    });

    // Draw nodes
    nodesRef.current.forEach(node => {
      const r = node._r;
      const color = node.color || actorColor(node.actor_type);

      // Glow for robots and agents
      if (node.actor_type !== 'human') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = `${color}22`;
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Actor ring
      const ring = ACTOR_RING[node.actor_type];
      if (ring) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.5 / k;
        ctx.stroke();
      }

      // Battery bar for robot nodes
      if (node.actor_type === 'robot' && node.battery_level != null) {
        const bw = r * 1.6, bh = 3, bx = node.x - bw / 2, by = node.y + r + 4;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(bx, by, bw, bh);
        const pct = Math.max(0, Math.min(1, node.battery_level / 100));
        ctx.fillStyle = pct < 0.2 ? '#D85A30' : pct < 0.5 ? '#BA7517' : '#1D9E75';
        ctx.fillRect(bx, by, bw * pct, bh);
      }

      // Label
      const fontSize = Math.max(8, Math.min(13, r * 1.1)) / k;
      ctx.fillStyle = 'rgba(240,235,255,0.9)';
      ctx.font = `${fontSize}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name,
        node.x,
        node.y + r + (node.battery_level != null ? 14 : 10) / k
      );
    });

    ctx.restore();
  }, [width, height]);

  // ---------------------------------------------------------------
  // Zoom + pan
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on('zoom', (evt) => {
        transform.current = evt.transform;
        render();
      });

    d3.select(canvas).call(zoom);
    return () => d3.select(canvas).on('.zoom', null);
  }, [render]);

  // ---------------------------------------------------------------
  // Drag
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function canvasPos(evt) {
      const rect = canvas.getBoundingClientRect();
      const { x, y, k } = transform.current;
      return {
        cx: (evt.clientX - rect.left - x) / k,
        cy: (evt.clientY - rect.top  - y) / k
      };
    }

    function findNode(cx, cy) {
      return nodesRef.current.find(n => {
        const dx = n.x - cx, dy = n.y - cy;
        return Math.sqrt(dx*dx + dy*dy) < n._r + 4;
      });
    }

    function onMouseDown(evt) {
      const { cx, cy } = canvasPos(evt);
      const node = findNode(cx, cy);
      if (node) {
        dragging.current = node;
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
      }
    }

    function onMouseMove(evt) {
      if (!dragging.current) return;
      const { cx, cy } = canvasPos(evt);
      dragging.current.fx = cx;
      dragging.current.fy = cy;
    }

    function onMouseUp() {
      if (!dragging.current) return;
      const node = dragging.current;
      onNodeDragEnd?.(node.id, node.x, node.y);
      node.fx = null;
      node.fy = null;
      dragging.current = null;
      simRef.current?.alphaTarget(0);
    }

    function onClick(evt) {
      const { cx, cy } = canvasPos(evt);
      const node = findNode(cx, cy);
      if (node) onNodeClick?.(node);
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
    };
  }, [onNodeClick, onNodeDragEnd]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', cursor: 'grab' }}
    />
  );
}

function nodeRadius(node) {
  const base = Math.max(6, Math.min(22, (node.val || 1) * 5));
  // Robots and agents slightly larger
  if (node.actor_type === 'robot') return base + 3;
  if (node.actor_type === 'agent') return base + 1;
  return base;
}
