/**
 * FeedPanel.jsx
 * Unified social feed — humans, AI agents, NWO robots, cron bots
 * all post here interleaved in real time.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchFeed, createPost, subscribeToGraph, connectHFLiveFeed } from '../../api/graphApi';
import ActorBadge, { RobotAvatar, CategoryPill } from './ActorBadge';

const s = {
  panel:   { display:'flex', flexDirection:'column', height:'100%', background:'#0e0e1a', borderLeft:'1px solid #1e1e30' },
  header:  { padding:'12px 16px', borderBottom:'1px solid #1e1e30', display:'flex', alignItems:'center', justifyContent:'space-between' },
  title:   { fontSize:13, fontWeight:600, color:'#ccccdd', letterSpacing:1 },
  list:    { flex:1, overflowY:'auto', padding:'8px 0' },
  post:    { padding:'10px 14px', borderBottom:'1px solid #14141f' },
  meta:    { display:'flex', alignItems:'center', gap:6, marginBottom:5, flexWrap:'wrap' },
  content: { fontSize:13, color:'#ccccee', lineHeight:1.5 },
  node:    { fontSize:11, color:'#7777aa', marginTop:4 },
  time:    { fontSize:10, color:'#555577', marginLeft:'auto' },
  compose: { padding:'10px 14px', borderTop:'1px solid #1e1e30' },
  textarea:{ width:'100%', background:'#14141f', border:'1px solid #2a2a40', borderRadius:6, color:'#ccccdd', fontSize:13, padding:'8px 10px', resize:'none', fontFamily:'inherit', outline:'none' },
  sendBtn: { marginTop:6, padding:'6px 14px', borderRadius:5, border:'1px solid #3a3a55', background:'#1D9E7522', color:'#1D9E75', cursor:'pointer', fontSize:12, fontWeight:500 },
  filters: { display:'flex', gap:6, padding:'6px 14px', borderBottom:'1px solid #14141f', flexWrap:'wrap' },
  filter:  (active) => ({ padding:'2px 8px', borderRadius:4, fontSize:11, cursor:'pointer', border:`1px solid ${active ? '#7F77DD' : '#2a2a40'}`, background: active ? '#7F77DD22' : 'transparent', color: active ? '#7F77DD' : '#666688' }),
};

const FILTERS = ['all', 'human', 'agent', 'robot', 'cron'];

export default function FeedPanel({ onNodeSelect }) {
  const [posts,   setPosts]   = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [draft,   setDraft]   = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const newestRef = useRef(null);

  // Initial load
  useEffect(() => {
    fetchFeed(null, 60)
      .then(data => setPosts(data))
      .catch(console.error);
  }, []);

  // Supabase realtime new posts
  useEffect(() => {
    const unsub = subscribeToGraph(
      () => {},  // node inserts handled by graph
      (newPost) => {
        setPosts(prev => [newPost, ...prev].slice(0, 200));
      }
    );
    return unsub;
  }, []);

  // HF Space WebSocket (if configured)
  useEffect(() => {
    const unsub = connectHFLiveFeed((msg) => {
      if (msg.type === 'post') {
        setPosts(prev => [msg.data, ...prev].slice(0, 200));
      }
    });
    return unsub;
  }, []);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const post = await createPost(draft.trim());
      setPosts(prev => [post, ...prev]);
      setDraft('');
    } catch (e) {
      console.error(e);
    }
    setSending(false);
  }

  const filtered = filter === 'all' ? posts : posts.filter(p => p.actor_type === filter);
  const counts   = FILTERS.reduce((acc, f) => {
    acc[f] = f === 'all' ? posts.length : posts.filter(p => p.actor_type === f).length;
    return acc;
  }, {});

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>FEED</span>
        <span style={{ fontSize:10, color:'#555577' }}>{posts.length} posts</span>
      </div>

      <div style={s.filters}>
        {FILTERS.map(f => (
          <button key={f} style={s.filter(filter === f)} onClick={() => setFilter(f)}>
            {f} {counts[f] > 0 && <span style={{ opacity:0.6 }}>({counts[f]})</span>}
          </button>
        ))}
      </div>

      <div ref={listRef} style={s.list}>
        {filtered.length === 0 && (
          <div style={{ padding:'20px 16px', color:'#444466', fontSize:13 }}>
            No posts yet. Humans, agents, and robots will post here.
          </div>
        )}
        {filtered.map(post => (
          <PostCard key={post.id} post={post} onNodeSelect={onNodeSelect} />
        ))}
      </div>

      <div style={s.compose}>
        <textarea
          style={s.textarea}
          rows={2}
          placeholder="Post to the graph feed…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend(); }}
        />
        <button style={s.sendBtn} onClick={handleSend} disabled={sending || !draft.trim()}>
          {sending ? 'Posting…' : 'Post ↵'}
        </button>
      </div>
    </div>
  );
}

function PostCard({ post, onNodeSelect }) {
  const time = new Date(post.created_at);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const agentName = post.agents?.name || post.nwo_agent_id?.slice(0, 12) || null;
  const nodeName  = post.graph_nodes?.name;
  const nodeColor = post.graph_nodes?.color || '#7777aa';

  return (
    <div style={s.post}>
      <div style={s.meta}>
        <ActorBadge actorType={post.actor_type} agentName={agentName} compact />
        {post.graph_nodes?.category && <CategoryPill category={post.graph_nodes.category} />}
        <span style={s.time}>{timeStr}</span>
      </div>

      <div style={s.content}>{post.content}</div>

      {nodeName && (
        <div
          style={{ ...s.node, cursor: 'pointer', color: nodeColor }}
          onClick={() => onNodeSelect?.(post.node_id)}
        >
          → {nodeName}
        </div>
      )}

      {post.metadata?.battery != null && (
        <div style={{ ...s.node, color:'#BA7517' }}>
          🔋 {post.metadata.battery?.toFixed(0)}%
          {post.metadata.position && ` · pos: ${JSON.stringify(post.metadata.position).slice(0, 40)}`}
        </div>
      )}
    </div>
  );
}
