/**
 * UI/index.jsx — AddNodeModal + GraphControls
 */

import { useState } from 'react';

// ---------------------------------------------------------------
// AddNodeModal
// ---------------------------------------------------------------
const CATEGORIES = ['topic','event','observation','task','inference'];

const overlay = { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 };
const modal   = { background:'#12121e', border:'1px solid #2a2a40', borderRadius:12, padding:24, width:380, maxWidth:'90vw' };
const label   = { fontSize:11, color:'#666688', letterSpacing:1, display:'block', marginBottom:4 };
const input   = { width:'100%', background:'#0a0a14', border:'1px solid #2a2a40', borderRadius:6, color:'#ccccdd', fontSize:13, padding:'8px 10px', outline:'none', fontFamily:'inherit', marginBottom:12 };
const btn     = (primary) => ({ padding:'8px 20px', borderRadius:6, border:`1px solid ${primary ? '#1D9E75' : '#2a2a40'}`, background: primary ? '#1D9E7522' : 'transparent', color: primary ? '#1D9E75' : '#888899', cursor:'pointer', fontSize:13 });

export function AddNodeModal({ onAdd, onClose }) {
  const [name,     setName]     = useState('');
  const [desc,     setDesc]     = useState('');
  const [category, setCategory] = useState('topic');
  const [saving,   setSaving]   = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd(name.trim(), desc.trim(), category);
    setSaving(false);
    onClose();
  }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ fontSize:16, fontWeight:500, color:'#e8e6f0', marginBottom:16 }}>Add graph node</div>

        <label style={label}>Name</label>
        <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="Topic or concept name" autoFocus />

        <label style={label}>Description</label>
        <textarea style={{ ...input, resize:'none' }} rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />

        <label style={label}>Category</label>
        <select style={{ ...input, cursor:'pointer' }} value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
          <button style={btn(false)} onClick={onClose}>Cancel</button>
          <button style={btn(true)} onClick={handleAdd} disabled={!name.trim() || saving}>
            {saving ? 'Adding…' : 'Add node'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// GraphControls — zoom, filter, layout buttons
// ---------------------------------------------------------------
const ctrl = { display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#12121e', borderBottom:'1px solid #1e1e30', flexWrap:'wrap' };
const cb   = { padding:'4px 10px', borderRadius:5, border:'1px solid #2a2a40', background:'transparent', color:'#888899', cursor:'pointer', fontSize:12 };
const filterActive = { ...cb, borderColor:'#7F77DD', color:'#7F77DD', background:'#7F77DD11' };

const ACTOR_FILTERS = [
  { key: 'all',   label: 'All nodes' },
  { key: 'human', label: '👤 Human' },
  { key: 'agent', label: '✦ Agent' },
  { key: 'robot', label: '⬡ Robot' },
];

export function GraphControls({ filter, onFilter, onAddNode, onRefresh, nodeCount, liveMode }) {
  return (
    <div style={ctrl}>
      <button style={{ ...cb, borderColor:'#1D9E75', color:'#1D9E75', background:'#1D9E7511' }} onClick={onAddNode}>
        + Node
      </button>

      <div style={{ width:1, height:16, background:'#2a2a40' }} />

      {ACTOR_FILTERS.map(f => (
        <button key={f.key} style={filter === f.key ? filterActive : cb} onClick={() => onFilter(f.key)}>
          {f.label}
        </button>
      ))}

      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
        {liveMode && (
          <span style={{ fontSize:10, color:'#1D9E75', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#1D9E75', display:'inline-block', animation:'pulse 2s ease-in-out infinite' }} />
            LIVE
          </span>
        )}
        <span style={{ fontSize:11, color:'#444466' }}>{nodeCount} nodes</span>
        <button style={cb} onClick={onRefresh} title="Refresh graph">↻</button>
      </div>
    </div>
  );
}
