/**
 * AddRobotModal.jsx — Human registers their own robot
 * PrivacyToggle.jsx  — Per-node public/private switch
 */

import { useState } from 'react';
import { humanRegisterRobot } from '../../api/authApi';

// ================================================================
// AddRobotModal
// ================================================================

const CAPABILITIES = [
  'vla_inference','task_planning','sensor_fusion','swarm_coordination',
  'iot_control','ros2_control','edge_inference','safety_monitoring',
  'cardiac_access','graph_write','telemetry_stream'
];

const s = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:16 },
  modal:   { background:'#12121e', border:'1px solid #2a2a40', borderRadius:14, padding:28, width:440, maxWidth:'100%', maxHeight:'90vh', overflowY:'auto' },
  title:   { fontSize:16, fontWeight:500, color:'#e8e6f0', marginBottom:4 },
  sub:     { fontSize:12, color:'#555577', marginBottom:20 },
  label:   { fontSize:11, color:'#666688', display:'block', marginBottom:4, letterSpacing:1 },
  input:   { width:'100%', background:'#0a0a14', border:'1px solid #2a2a40', borderRadius:6, color:'#ccccdd', fontSize:13, padding:'9px 11px', outline:'none', fontFamily:'inherit', marginBottom:12 },
  caps:    { display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 },
  cap:     (on) => ({ padding:'3px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:`1px solid ${on ? '#1D9E75' : '#2a2a40'}`, background: on ? '#1D9E7518' : 'transparent', color: on ? '#1D9E75' : '#555577' }),
  actions: { display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 },
  btn:     (color) => ({ padding:'8px 18px', borderRadius:6, border:`1px solid ${color}44`, background:`${color}18`, color, cursor:'pointer', fontSize:13 }),
  note:    { fontSize:11, color:'#555577', lineHeight:1.5, background:'#0a0a14', padding:'8px 10px', borderRadius:6, marginBottom:14 },
  ok:      { padding:'8px 12px', borderRadius:6, background:'#1D9E7518', border:'1px solid #1D9E7544', color:'#1D9E75', fontSize:12, marginBottom:12 },
  err:     { padding:'8px 12px', borderRadius:6, background:'#D85A3018', border:'1px solid #D85A3044', color:'#D85A30', fontSize:12, marginBottom:12 },
};

export function AddRobotModal({ userId, onAdded, onClose }) {
  const [name,    setName]    = useState('');
  const [nwoId,   setNwoId]   = useState('');
  const [type,    setType]    = useState('robot_controller');
  const [wallet,  setWallet]  = useState('');
  const [caps,    setCaps]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  function toggleCap(cap) {
    setCaps(prev => prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]);
  }

  async function handleAdd() {
    if (!name.trim() || !nwoId.trim()) { setError('Name and NWO Agent ID required'); return; }
    setLoading(true); setError('');
    try {
      const res = await humanRegisterRobot(userId, {
        name: name.trim(),
        nwoAgentId: nwoId.trim(),
        agentType: type,
        capabilities: caps,
        walletAddress: wallet.trim() || null,
      });
      setResult(res);
      onAdded?.(res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.title}>Register a robot</div>
        <div style={s.sub}>Link an NWO robot to your account. You control its graph permissions.</div>

        {error  && <div style={s.err}>{error}</div>}

        {result ? (
          <>
            <div style={s.ok}>
              ✓ Robot registered. API key: <code style={{ fontSize:10, wordBreak:'break-all' }}>{result.api_key}</code><br/>
              Load this key onto the robot as its <code>X-Robot-Key</code> header.
            </div>
            <div style={s.note}>
              By default, the robot can write to your <strong>private</strong> graph only.
              Enable public posting and telemetry in Robot Permissions.
            </div>
            <button style={s.btn('#1D9E75')} onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <div style={s.note}>
              The robot's NWO Agent ID comes from the NWO Robotics platform when the robot is registered there.
              This links the physical robot to your graph account.
            </div>

            <label style={s.label}>ROBOT NAME</label>
            <input style={s.input} placeholder="Atlas-01" value={name} onChange={e => setName(e.target.value)} autoFocus />

            <label style={s.label}>NWO AGENT ID</label>
            <input style={s.input} placeholder="agent_abc123" value={nwoId} onChange={e => setNwoId(e.target.value)} />

            <label style={s.label}>AGENT TYPE</label>
            <select style={{ ...s.input, cursor:'pointer' }} value={type} onChange={e => setType(e.target.value)}>
              <option value="robot_controller">Robot controller</option>
              <option value="autonomous_robot_controller">Autonomous robot</option>
              <option value="iot_gateway">IoT gateway</option>
              <option value="swarm_coordinator">Swarm coordinator</option>
            </select>

            <label style={s.label}>WALLET ADDRESS (optional, Base mainnet)</label>
            <input style={s.input} placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />

            <label style={s.label}>CAPABILITIES</label>
            <div style={s.caps}>
              {CAPABILITIES.map(cap => (
                <button key={cap} style={s.cap(caps.includes(cap))} onClick={() => toggleCap(cap)}>{cap}</button>
              ))}
            </div>

            <div style={s.actions}>
              <button style={s.btn('#888899')} onClick={onClose}>Cancel</button>
              <button style={s.btn('#1D9E75')} onClick={handleAdd} disabled={loading || !name || !nwoId}>
                {loading ? 'Registering…' : 'Register robot'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ================================================================
// PrivacyToggle — per-node visibility switch
// ================================================================

const ps = {
  wrap:   { display:'flex', alignItems:'center', gap:8 },
  btn:    (isPrivate) => ({
    display:'flex', alignItems:'center', gap:5, padding:'4px 10px',
    borderRadius:5, border:`1px solid ${isPrivate ? '#7F77DD44' : '#2a2a40'}`,
    background: isPrivate ? '#7F77DD11' : 'transparent',
    color: isPrivate ? '#7F77DD' : '#555577',
    cursor:'pointer', fontSize:11, fontWeight:500,
  }),
};

export function PrivacyToggle({ nodeId, isPrivate, onToggle, disabled }) {
  return (
    <div style={ps.wrap}>
      <button style={ps.btn(isPrivate)} onClick={() => onToggle?.(nodeId, !isPrivate)} disabled={disabled}>
        {isPrivate ? '🔒 Private' : '🌐 Public'}
      </button>
      {isPrivate && (
        <span style={{ fontSize:10, color:'#555577' }}>only you + your robots</span>
      )}
    </div>
  );
}
