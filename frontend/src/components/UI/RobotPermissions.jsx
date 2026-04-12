/**
 * RobotPermissions.jsx
 * Human owner manages robot permission grants.
 * Sensitive operations (telemetry publish, autonomous mode)
 * require cardiac credential issuance via NWO Relayer.
 */

import { useState, useEffect } from 'react';
import { getMyRobotPermissions, grantRobotPermission, revokeRobotPermission, logCardiacCredential, getPendingRequests, approveRequest, denyRequest } from '../../api/authApi';
import cardiac, { CREDENTIAL_TYPES } from '../../api/cardiacApi';

const s = {
  wrap:     { padding:16 },
  section:  { marginBottom:24 },
  title:    { fontSize:11, fontWeight:600, color:'#666688', letterSpacing:1, marginBottom:12 },
  card:     { background:'#12121e', border:'1px solid #2a2a40', borderRadius:10, padding:14, marginBottom:10 },
  name:     { fontSize:14, fontWeight:500, color:'#ddddee', marginBottom:4 },
  id:       { fontSize:10, color:'#444466', fontFamily:'monospace', marginBottom:10 },
  toggle:   { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #1a1a2e' },
  tLabel:   { fontSize:12, color:'#9999bb' },
  tNote:    { fontSize:10, color:'#555577', marginTop:1 },
  switch:   (on) => ({ width:36, height:20, borderRadius:10, background: on ? '#1D9E75' : '#2a2a40', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0, border:'none', padding:0 }),
  thumb:    (on) => ({ position:'absolute', top:3, left: on ? 17 : 3, width:14, height:14, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }),
  actions:  { display:'flex', gap:6, marginTop:10 },
  btn:      (color) => ({ padding:'5px 12px', borderRadius:5, border:`1px solid ${color}44`, background:`${color}11`, color, cursor:'pointer', fontSize:11 }),
  reqCard:  { background:'#0e0e1a', border:'1px solid #2a2a40', borderRadius:8, padding:12, marginBottom:8 },
  reqName:  { fontSize:13, fontWeight:500, color:'#ccccdd', marginBottom:3 },
  reqMeta:  { fontSize:11, color:'#555577', marginBottom:8 },
  msg:      { fontSize:11, color:'#BA7517', background:'#BA751711', padding:'6px 10px', borderRadius:5, marginTop:8 },
  cardiac:  { fontSize:11, color:'#7F77DD', background:'#7F77DD11', border:'1px solid #7F77DD33', padding:'6px 10px', borderRadius:5, marginTop:6 },
};

const TOGGLES = [
  { key:'can_post_public',      label:'Post to public graph',     note:'Robot nodes/posts visible to everyone', sensitive:false },
  { key:'can_post_telemetry',   label:'Publish telemetry',        note:'Telemetry visible in your private graph · Requires cardiac credential', sensitive:true },
  { key:'can_write_private',    label:'Write private graph',      note:'Robot can create private nodes only you see', sensitive:false },
  { key:'can_read_private',     label:'Read private graph',       note:'Robot can read your private nodes', sensitive:false },
  { key:'can_act_autonomously', label:'Autonomous mode',          note:'Robot acts without per-action approval · Requires cardiac credential', sensitive:true },
];

export default function RobotPermissions({ userId, userProfile }) {
  const [permissions, setPermissions] = useState([]);
  const [requests,    setRequests]    = useState([]);
  const [msg,         setMsg]         = useState({});
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      getMyRobotPermissions(userId),
      getPendingRequests(userId),
    ]).then(([perms, reqs]) => {
      setPermissions(perms);
      setRequests(reqs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  function setRobotMsg(agentId, text) {
    setMsg(prev => ({ ...prev, [agentId]: text }));
    setTimeout(() => setMsg(prev => ({ ...prev, [agentId]: '' })), 6000);
  }

  async function handleToggle(perm, key, value) {
    const toggle = TOGGLES.find(t => t.key === key);
    const isSensitive = toggle?.sensitive;

    // Sensitive operations require cardiac credential issuance
    if (isSensitive && value && !userProfile?.is_cardiac_verified) {
      setRobotMsg(perm.agent_id, '⬡ Cardiac verification required. Complete ECG verification in your profile first.');
      return;
    }

    setRobotMsg(perm.agent_id, 'Updating...');

    try {
      // Issue cardiac credential for sensitive permissions
      if (isSensitive && value && userProfile?.root_token_id) {
        const credType = key === 'can_post_telemetry'
          ? CREDENTIAL_TYPES.TELEMETRY_PUBLISH
          : CREDENTIAL_TYPES.GRAPH_WRITE;

        const credResult = await (key === 'can_post_telemetry'
          ? cardiac.grantTelemetryPublish(userProfile.root_token_id, perm.agents?.nwo_agent_id)
          : cardiac.grantGraphWrite(userProfile.root_token_id, perm.agents?.nwo_agent_id, perm.can_post_public));

        // Log credential
        if (credResult?.credentialHash) {
          await logCardiacCredential(
            userId, perm.agent_id, credType,
            credResult.credentialHash, credResult.tx,
            credResult.expiresAt ? new Date(credResult.expiresAt * 1000).toISOString() : null
          );
          setRobotMsg(perm.agent_id, `⬡ Cardiac credential issued on-chain`);
        }
      }

      // Update permission in DB
      const updated = await grantRobotPermission(userId, perm.agent_id, {
        ...perm,
        [key]: value,
        cardiac_verified: isSensitive ? true : perm.cardiac_verified,
      });

      setPermissions(prev => prev.map(p => p.agent_id === perm.agent_id ? { ...p, ...updated } : p));
      if (!isSensitive) setRobotMsg(perm.agent_id, 'Saved');

    } catch (e) {
      setRobotMsg(perm.agent_id, `Error: ${e.message}`);
    }
  }

  async function handleRevoke(agentId) {
    if (!confirm('Revoke all permissions for this robot?')) return;
    try {
      await revokeRobotPermission(userId, agentId);
      setPermissions(prev => prev.filter(p => p.agent_id !== agentId));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleApprove(req) {
    const perms = {
      can_post_public:  confirm('Allow robot to post to the PUBLIC graph?'),
      can_post_telemetry: false,  // always starts false; owner enables separately
      can_read_private: true,
      can_write_private: true,
      can_act_autonomously: false,
    };
    try {
      await approveRequest(req.id, userId, perms);
      setRequests(prev => prev.filter(r => r.id !== req.id));
      const newPerms = await getMyRobotPermissions(userId);
      setPermissions(newPerms);
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDeny(req) {
    const note = prompt('Reason for denial (optional):') || '';
    try {
      await denyRequest(req.id, note);
      setRequests(prev => prev.filter(r => r.id !== req.id));
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div style={{ ...s.wrap, color:'#444466', fontSize:13 }}>Loading...</div>;

  return (
    <div style={s.wrap}>

      {/* Pending access requests */}
      {requests.length > 0 && (
        <div style={s.section}>
          <div style={{ ...s.title, color:'#D85A30' }}>PENDING REQUESTS ({requests.length})</div>
          {requests.map(req => (
            <div key={req.id} style={s.reqCard}>
              <div style={s.reqName}>{req.robot_name}</div>
              <div style={s.reqMeta}>
                NWO ID: {req.nwo_agent_id}<br/>
                {req.requested_by && <span>Says: "{req.requested_by.slice(0, 100)}"</span>}
              </div>
              {req.capabilities?.length > 0 && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                  {req.capabilities.map(c => (
                    <span key={c} style={{ fontSize:10, color:'#666688', background:'#1a1a2e', padding:'2px 6px', borderRadius:3 }}>{c}</span>
                  ))}
                </div>
              )}
              <div style={s.actions}>
                <button style={s.btn('#1D9E75')} onClick={() => handleApprove(req)}>✓ Approve</button>
                <button style={s.btn('#D85A30')} onClick={() => handleDeny(req)}>✕ Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Existing permissions */}
      <div style={s.section}>
        <div style={s.title}>ROBOT PERMISSIONS ({permissions.length})</div>

        {permissions.length === 0 && (
          <div style={{ color:'#444466', fontSize:13 }}>
            No robots linked yet. Register a robot or approve a robot's access request.
          </div>
        )}

        {permissions.map(perm => (
          <div key={perm.agent_id} style={s.card}>
            <div style={s.name}>{perm.agents?.name || 'Unknown robot'}</div>
            <div style={s.id}>{perm.agents?.nwo_agent_id}</div>

            {TOGGLES.map(toggle => (
              <div key={toggle.key} style={s.toggle}>
                <div>
                  <div style={s.tLabel}>
                    {toggle.sensitive && <span style={{ color:'#7F77DD', marginRight:4 }}>⬡</span>}
                    {toggle.label}
                  </div>
                  <div style={s.tNote}>{toggle.note}</div>
                </div>
                <button
                  style={s.switch(perm[toggle.key])}
                  onClick={() => handleToggle(perm, toggle.key, !perm[toggle.key])}
                >
                  <span style={s.thumb(perm[toggle.key])} />
                </button>
              </div>
            ))}

            {perm.cardiac_verified && (
              <div style={s.cardiac}>⬡ Sensitive permissions verified via NWO Cardiac on Base mainnet</div>
            )}

            {msg[perm.agent_id] && <div style={s.msg}>{msg[perm.agent_id]}</div>}

            <div style={{ ...s.actions, marginTop:12 }}>
              <button style={s.btn('#D85A30')} onClick={() => handleRevoke(perm.agent_id)}>
                Revoke all
              </button>
            </div>
          </div>
        ))}
      </div>

      {!userProfile?.is_cardiac_verified && (
        <div style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #7F77DD33', background:'#7F77DD0a', fontSize:12, color:'#7F77DD' }}>
          ⬡ Add your cardiac identity in Profile to enable telemetry publishing and autonomous mode — these require on-chain credential issuance.
        </div>
      )}
    </div>
  );
}
