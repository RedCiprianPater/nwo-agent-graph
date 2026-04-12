/**
 * App.jsx v2
 * Full auth-aware layout.
 * Public graph visible without login.
 * Private nodes + robot management require Supabase session.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './api/graphApi';
import { getProfile, onAuthStateChange } from './api/authApi';
import LoginPage from './components/Auth/LoginPage';
import GraphCanvas from './components/Graph/GraphCanvas';
import NodeDetail  from './components/Graph/NodeDetail';
import FeedPanel   from './components/Feed/FeedPanel';
import RobotStatusPanel from './components/UI/RobotStatusPanel';
import { AddNodeModal, GraphControls } from './components/UI/index.jsx';
import { AddRobotModal } from './components/UI/AddRobotModal';
import RobotPermissions from './components/UI/RobotPermissions';
import {
  fetchGraph, createNode, saveNodePosition,
  subscribeToGraph, actorColor, setNodeVisibility
} from './api/graphApi';

const SIDEBAR = { ROBOTS:'robots', PERMISSIONS:'permissions', PROFILE:'profile' };

export default function App() {
  const [user,         setUser]         = useState(undefined); // undefined = loading
  const [userProfile,  setUserProfile]  = useState(null);
  const [showLogin,    setShowLogin]    = useState(false);
  const [graphData,    setGraphData]    = useState({ nodes:[], links:[] });
  const [filter,       setFilter]       = useState('all');
  const [selectedNode, setSelectedNode] = useState(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [showAddRobot, setShowAddRobot] = useState(false);
  const [sidebar,      setSidebar]      = useState(SIDEBAR.ROBOTS);
  const [showSidebar,  setShowSidebar]  = useState(true);
  const [liveMode,     setLiveMode]     = useState(false);
  const [dims,         setDims]         = useState({ w:800, h:600 });
  const [showFeed,     setShowFeed]     = useState(true);
  const [privateMode,  setPrivateMode]  = useState(false); // default node privacy
  const containerRef = useRef(null);

  // ---- Auth ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id) { setUserProfile(null); return; }
    getProfile(user.id).then(setUserProfile).catch(() => {});
  }, [user]);

  // ---- Graph load ----
  useEffect(() => { loadGraph(); }, [user]);

  async function loadGraph() {
    try {
      const data = await fetchGraph(!!user);
      setGraphData(data);
    } catch (e) { console.error('Graph load:', e); }
  }

  // ---- Realtime ----
  useEffect(() => {
    const unsub = subscribeToGraph(
      newNode => {
        setLiveMode(true);
        setGraphData(prev => ({
          nodes: dedup([newNode, ...prev.nodes]),
          links: prev.links
        }));
      },
      () => {}
    );
    return unsub;
  }, []);

  // ---- Canvas size ----
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: width, h: height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ---- Helpers ----
  function dedup(nodes) {
    const seen = new Set();
    return nodes.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; }).slice(0, 600);
  }

  const visibleNodes = filter === 'all'
    ? graphData.nodes
    : graphData.nodes.filter(n => n.actor_type === filter);

  const visibleIds   = new Set(visibleNodes.map(n => n.id));
  const visibleLinks = graphData.links.filter(
    l => visibleIds.has(l.source?.id || l.source) && visibleIds.has(l.target?.id || l.target)
  );

  async function handleAddNode(name, description, category) {
    const node = await createNode(name, description, category, user?.id, privateMode).catch(console.error);
    if (node) setGraphData(prev => ({ nodes: dedup([node, ...prev.nodes]), links: prev.links }));
  }

  const handleDragEnd = useCallback((nodeId, x, y) => {
    saveNodePosition(nodeId, x, y).catch(() => {});
  }, []);

  async function handleTogglePrivacy(nodeId, makePrivate) {
    const updated = await setNodeVisibility(nodeId, makePrivate ? 'private' : 'public').catch(console.error);
    if (updated) {
      setGraphData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, visibility: updated.visibility } : n) }));
      if (selectedNode?.id === nodeId) setSelectedNode(prev => ({ ...prev, visibility: updated.visibility }));
    }
  }

  function handleFeedNodeSelect(nodeId) {
    const n = graphData.nodes.find(n => n.id === nodeId);
    if (n) setSelectedNode(n);
  }

  if (user === undefined) return <div style={{ height:'100vh', background:'#08080f', display:'flex', alignItems:'center', justifyContent:'center', color:'#444466', fontSize:13 }}>Loading…</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0a0a0f' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', padding:'6px 12px', background:'#0d0d1a', borderBottom:'1px solid #1e1e30', gap:10 }}>
        <span style={{ fontSize:14, color:'#7F77DD', marginRight:4 }}>⬡</span>
        <span style={{ fontSize:13, fontWeight:500, color:'#ccccdd' }}>NWO Agent Graph</span>

        <GraphControls
          filter={filter}
          onFilter={setFilter}
          onAddNode={() => user ? setShowAdd(true) : setShowLogin(true)}
          onRefresh={loadGraph}
          nodeCount={visibleNodes.length}
          liveMode={liveMode}
          privateMode={privateMode}
          onTogglePrivateMode={() => setPrivateMode(v => !v)}
          isLoggedIn={!!user}
        />

        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          {user ? (
            <>
              {userProfile?.is_cardiac_verified && (
                <span title="Cardiac identity verified" style={{ fontSize:11, color:'#7F77DD' }}>⬡ Cardiac</span>
              )}
              <span style={{ fontSize:11, color:'#555577' }}>{user.email?.slice(0, 20)}</span>
              <button onClick={() => supabase.auth.signOut()} style={{ fontSize:11, padding:'3px 8px', border:'1px solid #2a2a40', borderRadius:4, background:'transparent', color:'#666688', cursor:'pointer' }}>
                Sign out
              </button>
            </>
          ) : (
            <button onClick={() => setShowLogin(true)} style={{ fontSize:12, padding:'4px 12px', border:'1px solid #1D9E7544', borderRadius:5, background:'#1D9E7514', color:'#1D9E75', cursor:'pointer' }}>
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left sidebar */}
        {showSidebar && (
          <div style={{ width:270, minWidth:270, background:'#0d0d1a', borderRight:'1px solid #1e1e30', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* Sidebar tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid #1e1e30' }}>
              {[
                [SIDEBAR.ROBOTS, '⬡ Robots'],
                ...(user ? [[SIDEBAR.PERMISSIONS, '🔐 Perms'], [SIDEBAR.PROFILE, '👤 Profile']] : [])
              ].map(([key, label]) => (
                <button key={key}
                  onClick={() => setSidebar(key)}
                  style={{ flex:1, padding:'8px 4px', border:'none', background: sidebar===key ? '#1a1a2e' : 'transparent', color: sidebar===key ? '#ccccdd' : '#444466', cursor:'pointer', fontSize:11, borderBottom: sidebar===key ? '2px solid #7F77DD' : '2px solid transparent' }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto' }}>
              {sidebar === SIDEBAR.ROBOTS && (
                <RobotStatusPanel
                  userId={user?.id}
                  onRobotNodeSelect={handleFeedNodeSelect}
                  onAddRobot={() => user ? setShowAddRobot(true) : setShowLogin(true)}
                />
              )}
              {sidebar === SIDEBAR.PERMISSIONS && user && (
                <RobotPermissions userId={user.id} userProfile={userProfile} />
              )}
              {sidebar === SIDEBAR.PROFILE && user && (
                <ProfilePanel user={user} profile={userProfile} onUpdate={setUserProfile} />
              )}
            </div>
          </div>
        )}

        {/* Sidebar toggle */}
        <button
          onClick={() => setShowSidebar(v => !v)}
          style={{ position:'absolute', left: showSidebar ? 268 : 0, top:'50%', transform:'translateY(-50%)', zIndex:20, background:'#1a1a2e', border:'1px solid #2a2a40', borderRadius:'0 6px 6px 0', color:'#555577', cursor:'pointer', padding:'8px 3px', fontSize:10 }}
        >
          {showSidebar ? '◀' : '▶'}
        </button>

        {/* Graph canvas */}
        <div ref={containerRef} style={{ flex:1, position:'relative', overflow:'hidden' }}>
          <GraphCanvas
            nodes={visibleNodes}
            links={visibleLinks}
            onNodeClick={setSelectedNode}
            onNodeDragEnd={handleDragEnd}
            width={dims.w}
            height={dims.h}
            currentUserId={user?.id}
          />

          {/* Legend */}
          <div style={{ position:'absolute', bottom:12, left:12, display:'flex', gap:8, flexWrap:'wrap' }}>
            {[['human','#1D9E75','👤'],['agent','#7F77DD','✦'],['robot','#D85A30','⬡'],['cron','#BA7517','⏱']].map(([t,c,i]) => (
              <span key={t} style={{ fontSize:10, color:c, background:`${c}15`, padding:'2px 7px', borderRadius:4, border:`1px solid ${c}30` }}>
                {i} {t}
              </span>
            ))}
            <span style={{ fontSize:10, color:'#555577', background:'#1a1a2e', padding:'2px 7px', borderRadius:4, border:'1px solid #2a2a40' }}>
              🔒 private
            </span>
          </div>

          {/* Node detail */}
          {selectedNode && (
            <NodeDetail
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              currentUserId={user?.id}
              onTogglePrivacy={user ? handleTogglePrivacy : null}
            />
          )}
        </div>

        {/* Feed */}
        {showFeed && (
          <div style={{ width:290, minWidth:290, borderLeft:'1px solid #1e1e30' }}>
            <FeedPanel
              userId={user?.id}
              onNodeSelect={handleFeedNodeSelect}
              privateMode={privateMode}
            />
          </div>
        )}
        <button
          onClick={() => setShowFeed(v => !v)}
          style={{ position:'absolute', right: showFeed ? 288 : 0, top:'50%', transform:'translateY(-50%)', zIndex:20, background:'#1a1a2e', border:'1px solid #2a2a40', borderRadius: showFeed ? '6px 0 0 6px' : '0 6px 6px 0', color:'#555577', cursor:'pointer', padding:'8px 3px', fontSize:10 }}
        >
          {showFeed ? '▶' : '◀'}
        </button>
      </div>

      {/* Modals */}
      {showLogin   && <LoginPage onLogin={() => setShowLogin(false)} />}
      {showAdd     && <AddNodeModal onAdd={handleAddNode} onClose={() => setShowAdd(false)} defaultPrivate={privateMode} />}
      {showAddRobot && user && <AddRobotModal userId={user.id} onAdded={() => {}} onClose={() => setShowAddRobot(false)} />}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0a0a14}
        ::-webkit-scrollbar-thumb{background:#2a2a40;border-radius:2px}
        button:disabled{opacity:.4;cursor:not-allowed}
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------
// Inline Profile panel (cardiac identity)
// ---------------------------------------------------------------
function ProfilePanel({ user, profile, onUpdate }) {
  const [wallet, setWallet] = useState(profile?.wallet_address || '');
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState('');

  async function save() {
    setSaving(true);
    const { updateProfile } = await import('./api/authApi');
    try {
      const updated = await updateProfile(user.id, { wallet_address: wallet, display_name: user.email });
      onUpdate(updated);
      setMsg('Saved');
    } catch (e) { setMsg(`Error: ${e.message}`); }
    setSaving(false);
    setTimeout(() => setMsg(''), 3000);
  }

  const s = { p:{ padding:16 }, label:{ fontSize:11, color:'#555577', display:'block', marginBottom:4, letterSpacing:1 }, input:{ width:'100%', background:'#0a0a14', border:'1px solid #2a2a40', borderRadius:6, color:'#ccccdd', fontSize:12, padding:'8px 10px', outline:'none', fontFamily:'inherit', marginBottom:10 }, btn:{ padding:'6px 14px', borderRadius:5, border:'1px solid #1D9E7544', background:'#1D9E7514', color:'#1D9E75', cursor:'pointer', fontSize:12 } };

  return (
    <div style={s.p}>
      <div style={{ fontSize:11, color:'#666688', letterSpacing:1, fontWeight:600, marginBottom:14 }}>PROFILE</div>
      <div style={{ fontSize:13, color:'#ccccdd', marginBottom:12 }}>{user.email}</div>

      {profile?.is_cardiac_verified ? (
        <div style={{ padding:'8px 10px', borderRadius:6, background:'#7F77DD11', border:'1px solid #7F77DD33', color:'#7F77DD', fontSize:12, marginBottom:12 }}>
          ⬡ Cardiac identity active<br/>
          <span style={{ fontSize:10, color:'#555577' }}>Token: {profile.root_token_id?.slice(0,16)}…</span>
        </div>
      ) : (
        <div style={{ padding:'8px 10px', borderRadius:6, background:'#14141f', border:'1px solid #2a2a40', color:'#555577', fontSize:11, marginBottom:12, lineHeight:1.5 }}>
          ⬡ No cardiac identity. Sign in with the Cardiac tab to link your ECG heartbeat identity from Base mainnet.
        </div>
      )}

      <label style={s.label}>WALLET (Base mainnet)</label>
      <input style={s.input} placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />

      <button style={s.btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {msg && <div style={{ fontSize:11, color:'#1D9E75', marginTop:8 }}>{msg}</div>}
    </div>
  );
}
