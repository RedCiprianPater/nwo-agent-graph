/**
 * graphApi.js v2 — Privacy-aware graph API
 * Public nodes: no auth needed.
 * Private nodes: require Supabase session (owner only).
 * Robot writes: go through Worker with X-Robot-Key.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
const WORKER_URL    = import.meta.env.VITE_WORKER_URL || '';
const HF_SPACE_URL  = import.meta.env.VITE_HF_SPACE_URL || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

// ---------------------------------------------------------------
// Graph data — public + private (RLS handles filtering)
// ---------------------------------------------------------------
export async function fetchGraph(includePrivate = false) {
  let nodeQuery = supabase
    .from('graph_nodes')
    .select('id,name,val,color,depth_level,description,category,actor_type,visibility,owner_user_id,x_position,y_position,nwo_agent_id,battery_level,created_at')
    .order('created_at', { ascending: false })
    .limit(600);

  // RLS will auto-filter private nodes to owner; we just ask for all
  const { data: nodes, error: ne } = await nodeQuery;
  const { data: links, error: le } = await supabase
    .from('graph_links')
    .select('source_id,target_id,similarity_score,link_type,visibility')
    .limit(1200);

  if (ne || le) throw new Error(ne?.message || le?.message);
  return {
    nodes: (nodes || []).map(normalizeNode),
    links: (links || []).map(l => ({
      source: l.source_id,
      target: l.target_id,
      value: parseFloat(l.similarity_score) || 0.5,
      link_type: l.link_type,
      visibility: l.visibility,
    }))
  };
}

function normalizeNode(n) {
  return {
    id: n.id,
    name: n.name,
    val: parseFloat(n.val) || 1,
    color: n.color || actorColor(n.actor_type),
    depth_level: n.depth_level || 0,
    description: n.description,
    category: n.category,
    actor_type: n.actor_type,
    visibility: n.visibility || 'public',
    owner_user_id: n.owner_user_id,
    x: n.x_position || null,
    y: n.y_position || null,
    nwo_agent_id: n.nwo_agent_id,
    battery_level: n.battery_level,
    created_at: n.created_at,
  };
}

// ---------------------------------------------------------------
// Feed — public + owner's private posts
// ---------------------------------------------------------------
export async function fetchFeed(since = null, limit = 60) {
  let q = supabase
    .from('graph_posts')
    .select('id,content,actor_type,nwo_agent_id,created_at,metadata,node_id,visibility,owner_user_id,graph_nodes(name,category,color),agents(name,avatar_label,persona_color)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (since) q = q.gt('created_at', since);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------
// Create node (human)
// ---------------------------------------------------------------
export async function createNode(name, description, category = 'topic', userId = null, isPrivate = false) {
  const { data, error } = await supabase.from('graph_nodes').insert({
    name,
    description,
    category,
    val: 2.0,
    color: '#1D9E75',
    depth_level: 0,
    actor_type: 'human',
    user_id: userId,
    owner_user_id: userId,
    visibility: isPrivate ? 'private' : 'public',
    expand_requested: true,
    expand_done: false,
  }).select().single();
  if (error) throw error;
  return normalizeNode(data);
}

// ---------------------------------------------------------------
// Toggle node privacy
// ---------------------------------------------------------------
export async function setNodeVisibility(nodeId, visibility) {
  const { data, error } = await supabase
    .from('graph_nodes')
    .update({ visibility })
    .eq('id', nodeId)
    .select()
    .single();
  if (error) throw error;
  return normalizeNode(data);
}

// ---------------------------------------------------------------
// Save node position (after drag)
// ---------------------------------------------------------------
export async function saveNodePosition(nodeId, x, y) {
  await supabase.from('graph_nodes').update({ x_position: x, y_position: y }).eq('id', nodeId);
}

// ---------------------------------------------------------------
// Create post (human)
// ---------------------------------------------------------------
export async function createPost(content, nodeId = null, userId = null, isPrivate = false) {
  const { data, error } = await supabase.from('graph_posts').insert({
    content,
    node_id: nodeId,
    actor_type: 'human',
    actor_id: userId,
    owner_user_id: userId,
    visibility: isPrivate ? 'private' : 'public',
  }).select().single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------
// Request expansion
// ---------------------------------------------------------------
export async function requestExpansion(nodeId) {
  await supabase.from('graph_nodes').update({ expand_requested: true, expand_done: false }).eq('id', nodeId);
}

// ---------------------------------------------------------------
// Robot telemetry (owner-only)
// ---------------------------------------------------------------
export async function fetchMyTelemetry(nwoAgentId, limit = 20) {
  const { data, error } = await supabase
    .from('robot_telemetry')
    .select('id,position,battery_level,reward,joint_angles,created_at,node_id')
    .eq('nwo_agent_id', nwoAgentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------
// Registered robots (owner sees their own)
// ---------------------------------------------------------------
export async function fetchMyRobots(userId) {
  const { data, error } = await supabase
    .from('agents')
    .select('id,name,agent_type,capabilities,nwo_agent_id,persona_color,avatar_label,trust_level,registration_mode,is_active,created_at')
    .eq('owner_user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Public autonomous robots (no owner)
export async function fetchPublicRobots() {
  const { data, error } = await supabase
    .from('agents')
    .select('id,name,agent_type,capabilities,nwo_agent_id,persona_color,avatar_label,trust_level')
    .eq('registration_mode', 'autonomous')
    .eq('is_active', true)
    .limit(50);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------
// Realtime subscriptions
// ---------------------------------------------------------------
export function subscribeToGraph(onNode, onPost) {
  const nodeChannel = supabase
    .channel('graph_nodes_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'graph_nodes' }, p => onNode(normalizeNode(p.new)))
    .subscribe();

  const postChannel = supabase
    .channel('graph_posts_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'graph_posts' }, p => onPost(p.new))
    .subscribe();

  const updateChannel = supabase
    .channel('graph_nodes_update')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'graph_nodes' }, p => onNode(normalizeNode(p.new)))
    .subscribe();

  return () => {
    supabase.removeChannel(nodeChannel);
    supabase.removeChannel(postChannel);
    supabase.removeChannel(updateChannel);
  };
}

// ---------------------------------------------------------------
// HF Space WebSocket (live version)
// ---------------------------------------------------------------
export function connectHFLiveFeed(onMessage) {
  if (!HF_SPACE_URL) return () => {};
  const wsUrl = HF_SPACE_URL.replace(/^https?/, wsp => wsp === 'https' ? 'wss' : 'ws') + '/ws/feed';
  let ws, retries = 0;

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onmessage = evt => { try { onMessage(JSON.parse(evt.data)); } catch {} };
    ws.onclose = () => { if (retries++ < 5) setTimeout(connect, 2000 * retries); };
    ws.onerror = () => {};
  }
  connect();
  return () => { retries = 99; ws?.close(); };
}

// ---------------------------------------------------------------
// Utils
// ---------------------------------------------------------------
export function actorColor(actorType) {
  return { human:'#1D9E75', agent:'#7F77DD', robot:'#D85A30', cron:'#BA7517' }[actorType] || '#888780';
}
export function actorLabel(actorType) {
  return { human:'Human', agent:'Agent', robot:'Robot', cron:'Auto' }[actorType] || actorType;
}
export function categoryColor(category) {
  const m = { topic:'#1D9E75',event:'#D85A30',observation:'#0F6E56',task:'#7F77DD',inference:'#534AB7',sensor:'#639922',swarm:'#7F77DD',iot:'#0F6E56',telemetry:'#BA7517' };
  return m[category] || '#888780';
}
