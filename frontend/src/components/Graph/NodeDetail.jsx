/**
 * NodeDetail.jsx
 * Sidebar shown when a graph node is clicked.
 * For robot nodes: shows live state + NWO action buttons.
 */

import { useState, useEffect } from 'react';
import { requestExpansion, fetchRobotTelemetry, actorLabel, actorColor } from '../../api/graphApi';
import nwo from '../../api/nwoApi';

const s = {
  panel: { position:'absolute', right:0, top:0, bottom:0, width:320, background:'#12121e', borderLeft:'1px solid #2a2a40', padding:16, overflowY:'auto', zIndex:10 },
  close: { position:'absolute', top:12, right:12, background:'none', border:'none', color:'#8888aa', fontSize:20, cursor:'pointer' },
  badge: (color) => ({ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:500, background:`${color}22`, color, marginRight:6, marginBottom:4 }),
  name:  { fontSize:18, fontWeight:500, color:'#e8e6f0', marginBottom:6 },
  desc:  { fontSize:13, color:'#9999bb', lineHeight:1.5, marginBottom:12 },
  label: { fontSize:11, color:'#6666aa', textTransform:'uppercase', letterSpacing:1, marginBottom:4 },
  val:   { fontSize:14, color:'#ccccdd', marginBottom:10 },
  btn:   { display:'block', width:'100%', padding:'8px 12px', marginBottom:6, borderRadius:6, border:'1px solid #3a3a55', background:'#1a1a2e', color:'#ccccdd', cursor:'pointer', fontSize:13, textAlign:'left' },
  dangerBtn: { display:'block', width:'100%', padding:'8px 12px', marginBottom:6, borderRadius:6, border:'1px solid #D85A3066', background:'#D85A3011', color:'#D85A30', cursor:'pointer', fontSize:13, textAlign:'left' },
  battery: { height:6, borderRadius:3, background:'#2a2a40', overflow:'hidden', marginBottom:10 },
  telemRow: { display:'flex', justifyContent:'space-between', fontSize:12, color:'#9999bb', padding:'4px 0', borderBottom:'1px solid #1e1e32' },
};

export default function NodeDetail({ node, onClose }) {
  const [robotState, setRobotState] = useState(null);
  const [telemetry,  setTelemetry]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [msg,        setMsg]        = useState('');

  const isRobot = node.actor_type === 'robot';

  useEffect(() => {
    if (!isRobot || !node.nwo_agent_id) return;
    setLoading(true);
    Promise.all([
      nwo.queryRobotState(node.nwo_agent_id).catch(() => null),
      fetchRobotTelemetry(node.nwo_agent_id, 10)
    ]).then(([state, telem]) => {
      setRobotState(state);
      setTelemetry(telem);
      setLoading(false);
    });
  }, [node.id, isRobot, node.nwo_agent_id]);

  async function handleExpand() {
    setMsg('Queued for BitNet expansion...');
    await requestExpansion(node.id).catch(() => {});
    setTimeout(() => setMsg(''), 3000);
  }

  async function handleEmergencyStop() {
    if (!node.nwo_agent_id) return;
    setMsg('Sending emergency stop...');
    await nwo.emergencyStop(node.nwo_agent_id).catch(e => setMsg(`Error: ${e.message}`));
    setMsg('Emergency stop sent');
    setTimeout(() => setMsg(''), 4000);
  }

  async function handleInferenceTest() {
    if (!node.nwo_agent_id) return;
    setMsg('Running inference...');
    try {
      const result = await nwo.inference(`Describe your current state and surroundings`, [], null, node.nwo_agent_id);
      setMsg(`Inference: ${JSON.stringify(result).slice(0, 120)}`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  }

  async function handlePlanTask() {
    if (!node.nwo_agent_id) return;
    const instr = prompt('Task instruction for robot:');
    if (!instr) return;
    setMsg('Planning task...');
    try {
      const plan = await nwo.planTask(instr, node.nwo_agent_id, 'mock');
      setMsg(`Plan created: ${plan.task_id}`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  }

  const color = actorColor(node.actor_type);

  return (
    <div style={s.panel}>
      <button style={s.close} onClick={onClose}>×</button>

      <div style={{ marginBottom: 12 }}>
        <span style={s.badge(color)}>{actorLabel(node.actor_type)}</span>
        {node.category && <span style={s.badge('#639922')}>{node.category}</span>}
      </div>

      <div style={s.name}>{node.name}</div>
      {node.description && <div style={s.desc}>{node.description}</div>}

      {/* Battery */}
      {node.battery_level != null && (
        <>
          <div style={s.label}>Battery</div>
          <div style={s.battery}>
            <div style={{ height:'100%', width:`${node.battery_level}%`, background: node.battery_level < 20 ? '#D85A30' : '#1D9E75', borderRadius:3 }} />
          </div>
          <div style={{ ...s.val, marginTop:-6 }}>{node.battery_level.toFixed(0)}%</div>
        </>
      )}

      {/* NWO agent ID */}
      {node.nwo_agent_id && (
        <>
          <div style={s.label}>NWO Agent ID</div>
          <div style={{ ...s.val, fontFamily:'monospace', fontSize:11, wordBreak:'break-all' }}>{node.nwo_agent_id}</div>
        </>
      )}

      {/* Live robot state */}
      {isRobot && (
        <div style={{ marginBottom:12 }}>
          <div style={s.label}>Live State</div>
          {loading && <div style={s.desc}>Loading...</div>}
          {robotState && (
            <div style={{ fontSize:12, color:'#9999bb' }}>
              <div style={s.telemRow}><span>Battery</span><span>{robotState.battery_level?.toFixed(1)}%</span></div>
              <div style={s.telemRow}><span>Position</span><span>{JSON.stringify(robotState.position || {}).slice(0, 60)}</span></div>
              <div style={s.telemRow}><span>Task</span><span>{robotState.current_task || 'idle'}</span></div>
            </div>
          )}
        </div>
      )}

      {/* Telemetry history */}
      {isRobot && telemetry.length > 0 && (
        <div style={{ marginBottom:12 }}>
          <div style={s.label}>Telemetry ({telemetry.length})</div>
          {telemetry.slice(0, 5).map(t => (
            <div key={t.id} style={s.telemRow}>
              <span>{new Date(t.created_at).toLocaleTimeString()}</span>
              <span>🔋 {t.battery_level?.toFixed(0)}% rew:{t.reward?.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={s.label}>Actions</div>
      <button style={s.btn} onClick={handleExpand}>
        ✦ Queue BitNet expansion
      </button>

      {isRobot && node.nwo_agent_id && (
        <>
          <button style={s.btn} onClick={handleInferenceTest}>
            ▶ Run VLA inference
          </button>
          <button style={s.btn} onClick={handlePlanTask}>
            📋 Plan task
          </button>
          <button style={s.dangerBtn} onClick={handleEmergencyStop}>
            ⛔ Emergency stop
          </button>
        </>
      )}

      {msg && (
        <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, background:'#1a1a2e', border:'1px solid #3a3a55', fontSize:12, color:'#aaaacc', wordBreak:'break-word' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
