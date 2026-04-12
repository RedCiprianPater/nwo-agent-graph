/**
 * RobotStatusPanel.jsx
 * Shows all registered NWO robots, their live status,
 * and quick-action buttons that write into the graph.
 */

import { useState, useEffect } from 'react';
import { fetchRobots } from '../../api/graphApi';
import nwo from '../../api/nwoApi';

const s = {
  panel:   { padding:14, overflowY:'auto' },
  title:   { fontSize:11, fontWeight:600, color:'#888899', letterSpacing:1, marginBottom:12 },
  card:    { background:'#12121e', border:'1px solid #2a2a40', borderRadius:8, padding:12, marginBottom:10 },
  name:    { fontSize:13, fontWeight:500, color:'#ddddee', marginBottom:4 },
  id:      { fontSize:10, color:'#555577', fontFamily:'monospace', marginBottom:8, wordBreak:'break-all' },
  row:     { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 },
  label:   { fontSize:11, color:'#666688' },
  val:     { fontSize:11, color:'#aaaacc' },
  battery: { height:4, borderRadius:2, background:'#1a1a2e', overflow:'hidden', margin:'6px 0 8px' },
  actions: { display:'flex', gap:6, flexWrap:'wrap', marginTop:8 },
  btn:     { padding:'4px 10px', borderRadius:4, border:'1px solid #2a2a40', background:'#1a1a2e', color:'#aaaacc', cursor:'pointer', fontSize:11 },
  stopBtn: { padding:'4px 10px', borderRadius:4, border:'1px solid #D85A3044', background:'#D85A3011', color:'#D85A30', cursor:'pointer', fontSize:11 },
  reg:     { padding:'8px 10px', borderRadius:6, border:'1px dashed #2a2a40', fontSize:12, color:'#555577', textAlign:'center', cursor:'pointer', marginTop:4 },
  msg:     { fontSize:11, color:'#BA7517', marginTop:6, padding:'4px 8px', background:'#BA751711', borderRadius:4 },
};

export default function RobotStatusPanel({ onRobotNodeSelect }) {
  const [robots,   setRobots]   = useState([]);
  const [states,   setStates]   = useState({});
  const [messages, setMessages] = useState({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetchRobots()
      .then(data => { setRobots(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Poll states every 30s
  useEffect(() => {
    if (!robots.length) return;
    function pollAll() {
      robots.forEach(r => {
        if (!r.nwo_agent_id) return;
        nwo.queryRobotState(r.nwo_agent_id).then(state => {
          setStates(prev => ({ ...prev, [r.nwo_agent_id]: state }));
        }).catch(() => {});
      });
    }
    pollAll();
    const id = setInterval(pollAll, 30000);
    return () => clearInterval(id);
  }, [robots]);

  function setMsg(agentId, msg) {
    setMessages(prev => ({ ...prev, [agentId]: msg }));
    setTimeout(() => setMessages(prev => ({ ...prev, [agentId]: '' })), 5000);
  }

  async function handleStop(robot) {
    setMsg(robot.nwo_agent_id, 'Stopping...');
    try {
      await nwo.emergencyStop(robot.nwo_agent_id);
      setMsg(robot.nwo_agent_id, '⛔ Stop sent');
    } catch (e) {
      setMsg(robot.nwo_agent_id, `Error: ${e.message}`);
    }
  }

  async function handleInfer(robot) {
    setMsg(robot.nwo_agent_id, 'Running inference...');
    try {
      const r = await nwo.inference('Describe your environment and current state', [], null, robot.nwo_agent_id);
      setMsg(robot.nwo_agent_id, JSON.stringify(r).slice(0, 120));
    } catch (e) {
      setMsg(robot.nwo_agent_id, `Error: ${e.message}`);
    }
  }

  async function handlePlan(robot) {
    const instr = window.prompt(`Task for ${robot.name}:`);
    if (!instr) return;
    setMsg(robot.nwo_agent_id, 'Planning...');
    try {
      const plan = await nwo.planTask(instr, robot.nwo_agent_id, 'mock');
      setMsg(robot.nwo_agent_id, `Plan ${plan.task_id}: ${plan.phases?.length || 0} phases`);
    } catch (e) {
      setMsg(robot.nwo_agent_id, `Error: ${e.message}`);
    }
  }

  async function handleRegisterNew() {
    const name    = window.prompt('Robot name:');
    if (!name) return;
    const nwoId   = window.prompt('NWO Agent ID (from NWO platform):');
    if (!nwoId) return;
    const apiKey  = window.prompt('NWO API key for this robot:');
    if (!apiKey) return;
    localStorage.setItem('nwo_api_key', apiKey);
    try {
      const result = await nwo.registerAgent(name, 'robot_controller', ['graph_integration']);
      alert(`Registered! Robot API key: ${result.graph?.api_key}`);
      const data = await fetchRobots();
      setRobots(data);
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  if (loading) return <div style={{ ...s.panel, color:'#444466', fontSize:13 }}>Loading robots...</div>;

  return (
    <div style={s.panel}>
      <div style={s.title}>NWO ROBOTS ({robots.length})</div>

      {robots.map(robot => {
        const state = states[robot.nwo_agent_id] || {};
        const batt  = state.battery_level ?? null;
        const color = robot.persona_color || '#D85A30';
        return (
          <div key={robot.id} style={s.card}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', background:`${color}22`, border:`1.5px solid ${color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color, flexShrink:0 }}>
                {robot.avatar_label || '⬡'}
              </div>
              <div>
                <div style={s.name}>{robot.name}</div>
                <div style={s.id}>{robot.nwo_agent_id}</div>
              </div>
            </div>

            {batt != null && (
              <>
                <div style={s.row}>
                  <span style={s.label}>Battery</span>
                  <span style={{ ...s.val, color: batt < 20 ? '#D85A30' : batt < 50 ? '#BA7517' : '#1D9E75' }}>{batt.toFixed(0)}%</span>
                </div>
                <div style={s.battery}>
                  <div style={{ height:'100%', width:`${batt}%`, background: batt < 20 ? '#D85A30' : batt < 50 ? '#BA7517' : '#1D9E75', borderRadius:2, transition:'width 0.5s' }} />
                </div>
              </>
            )}

            {state.current_task && (
              <div style={s.row}>
                <span style={s.label}>Task</span>
                <span style={s.val}>{String(state.current_task).slice(0, 40)}</span>
              </div>
            )}

            {robot.capabilities?.length > 0 && (
              <div style={{ ...s.row, flexWrap:'wrap', gap:4 }}>
                {robot.capabilities.map(c => (
                  <span key={c} style={{ fontSize:10, color:'#667755', padding:'1px 5px', border:'1px solid #2a2a40', borderRadius:3 }}>{c}</span>
                ))}
              </div>
            )}

            <div style={s.actions}>
              <button style={s.btn} onClick={() => handleInfer(robot)}>▶ Infer</button>
              <button style={s.btn} onClick={() => handlePlan(robot)}>📋 Plan</button>
              <button style={s.stopBtn} onClick={() => handleStop(robot)}>⛔ Stop</button>
            </div>

            {messages[robot.nwo_agent_id] && (
              <div style={s.msg}>{messages[robot.nwo_agent_id]}</div>
            )}
          </div>
        );
      })}

      <div style={s.reg} onClick={handleRegisterNew}>
        + Register NWO Robot
      </div>
    </div>
  );
}
