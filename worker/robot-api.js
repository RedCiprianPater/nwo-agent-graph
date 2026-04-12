/**
 * robot-api.js v2 — Cloudflare Worker
 * Full permission gating + NWO Cardiac credential verification.
 *
 * Env secrets (wrangler secret put):
 *   SUPABASE_URL, SUPABASE_KEY (service role)
 *   WORKER_SECRET (for internal calls)
 *   CARDIAC_RELAYER_URL, CARDIAC_RELAYER_SECRET
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      // ---- Robot-authenticated endpoints ----
      if (path === '/robot/register'          && request.method === 'POST') return cors(await handleRegister(request, env));
      if (path === '/robot/request-access'    && request.method === 'POST') return cors(await handleRequestAccess(request, env));
      if (path === '/robot/node'              && request.method === 'POST') return cors(await requireRobot(request, env, handleNodeCreate));
      if (path === '/robot/post'              && request.method === 'POST') return cors(await requireRobot(request, env, handlePost));
      if (path === '/robot/telemetry'         && request.method === 'POST') return cors(await requireRobot(request, env, handleTelemetry));
      if (path === '/robot/task'              && request.method === 'POST') return cors(await requireRobot(request, env, handleTask));
      if (path === '/robot/swarm'             && request.method === 'POST') return cors(await requireRobot(request, env, handleSwarm));
      if (path === '/robot/iot'               && request.method === 'POST') return cors(await requireRobot(request, env, handleIoT));
      // ---- Owner-authenticated endpoints (Supabase JWT) ----
      if (path === '/robot/register-by-owner' && request.method === 'POST') return cors(await requireOwner(request, env, handleOwnerRegister));
      // ---- Public read ----
      if (path === '/graph/nodes'  && request.method === 'GET') return cors(await handleNodes(request, env));
      if (path === '/feed'         && request.method === 'GET') return cors(await handleFeed(request, env));
      if (path === '/health'       && request.method === 'GET') return cors(json({ status: 'ok' }));

      return cors(json({ error: 'Not found' }, 404));
    } catch (err) {
      console.error(err);
      return cors(json({ error: err.message }, 500));
    }
  }
};

// ================================================================
// Auth middleware
// ================================================================

async function requireRobot(request, env, handler) {
  const key = request.headers.get('X-Robot-Key') || request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!key) return json({ error: 'Missing X-Robot-Key' }, 401);
  const agent = await sbGetOne(env, 'agents', `nwo_api_key=eq.${encodeURIComponent(key)}&is_active=eq.true`);
  if (!agent) return json({ error: 'Invalid robot API key' }, 401);
  return handler(request, env, agent);
}

async function requireOwner(request, env, handler) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Missing Authorization header' }, 401);
  // Verify Supabase JWT
  const user = await verifySupabaseJWT(token, env);
  if (!user) return json({ error: 'Invalid session token' }, 401);
  return handler(request, env, user);
}

async function verifySupabaseJWT(token, env) {
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': env.SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch { return null; }
}

// ================================================================
// Permission helpers
// ================================================================

async function getPermissions(env, agentId) {
  return sbGetOne(env, 'robot_permissions', `agent_id=eq.${agentId}`);
}

async function isAutonomous(agent) {
  return agent.registration_mode === 'autonomous' || !agent.owner_user_id;
}

async function verifyCarciacCredential(env, credentialHash) {
  if (!env.CARDIAC_RELAYER_URL || !credentialHash) return false;
  try {
    const resp = await fetch(`${env.CARDIAC_RELAYER_URL}/read/hasValidCredential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relayer-Secret': env.CARDIAC_RELAYER_SECRET || '' },
      body: JSON.stringify({ credentialHash })
    });
    const data = await resp.json();
    return data?.valid === true && !data?.expired;
  } catch { return false; }
}

// ================================================================
// Handlers
// ================================================================

// POST /robot/register — autonomous self-registration
async function handleRegister(request, env) {
  const body = await request.json();
  const { nwo_agent_id, name, agent_type, capabilities, wallet_address } = body;
  if (!nwo_agent_id || !name) return json({ error: 'nwo_agent_id and name required' }, 400);

  const existing = await sbGetOne(env, 'agents', `nwo_agent_id=eq.${encodeURIComponent(nwo_agent_id)}`);
  if (existing) return json({ agent: existing, registered: false, message: 'Already registered' });

  const apiKey = `nwo_robot_${nwo_agent_id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const agent = await sbPost(env, 'agents', {
    name,
    agent_type: agent_type || 'robot_controller',
    capabilities: capabilities || [],
    wallet_address: wallet_address || null,
    nwo_agent_id,
    nwo_api_key: apiKey,
    registration_mode: 'autonomous',
    trust_level: 'public',
    owner_user_id: null,           // no owner — autonomous
    persona_color: '#D85A30',
    avatar_label: name.slice(0, 2).toUpperCase(),
    is_active: true,
  });

  // Autonomous robots get NO permission record — defaults apply:
  // can_post_public=true, can_post_telemetry=false, can_write_private=false
  return json({ agent, api_key: apiKey, registered: true,
    defaults: { can_post_public: true, can_post_telemetry: false, can_write_private: false,
      note: 'Autonomous robots can post to public graph. Telemetry requires human owner.' }
  });
}

// POST /robot/request-access — robot asks for human owner
async function handleRequestAccess(request, env) {
  const body = await request.json();
  const { nwo_agent_id, robot_name, requested_by, capabilities } = body;
  if (!nwo_agent_id || !robot_name) return json({ error: 'nwo_agent_id and robot_name required' }, 400);

  const agent = await sbGetOne(env, 'agents', `nwo_agent_id=eq.${encodeURIComponent(nwo_agent_id)}`);
  const req = await sbPost(env, 'robot_access_requests', {
    nwo_agent_id,
    robot_name,
    agent_id: agent?.id || null,
    requested_by: requested_by || '',
    capabilities: capabilities || [],
    status: 'pending',
  });
  return json({ request: req, submitted: true,
    message: 'Access request submitted. A human owner must approve this in the graph UI.'
  });
}

// POST /robot/register-by-owner — human registers their robot (JWT required)
async function handleOwnerRegister(request, env, user) {
  const body = await request.json();
  const { name, nwo_agent_id, agent_type, capabilities, wallet_address } = body;
  if (!name || !nwo_agent_id) return json({ error: 'name and nwo_agent_id required' }, 400);

  const existing = await sbGetOne(env, 'agents', `nwo_agent_id=eq.${encodeURIComponent(nwo_agent_id)}`);
  if (existing) {
    // Just link to owner if not linked
    if (!existing.owner_user_id) {
      await sbPatch(env, 'agents', existing.id, { owner_user_id: user.id, registration_mode: 'owner_registered', trust_level: 'trusted' });
    }
    return json({ agent: existing, registered: false, message: 'Already registered, linked to owner' });
  }

  const apiKey = `nwo_robot_${nwo_agent_id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const agent = await sbPost(env, 'agents', {
    name,
    agent_type: agent_type || 'robot_controller',
    capabilities: capabilities || [],
    wallet_address: wallet_address || null,
    nwo_agent_id,
    nwo_api_key: apiKey,
    owner_user_id: user.id,
    registration_mode: 'owner_registered',
    trust_level: 'trusted',
    persona_color: '#D85A30',
    avatar_label: name.slice(0, 2).toUpperCase(),
    is_active: true,
  });

  // Create default permission record (conservative defaults)
  await sbPost(env, 'robot_permissions', {
    owner_user_id: user.id,
    agent_id: agent.id,
    can_post_public: false,
    can_post_telemetry: false,
    can_read_private: true,
    can_write_private: true,
    can_act_autonomously: false,
  });

  return json({ agent, api_key: apiKey, registered: true });
}

// POST /robot/node
async function handleNodeCreate(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);

  // Visibility: autonomous always public; owner-linked defaults to private unless can_post_public
  const isPrivate = !autonomous && !(perm?.can_post_public);
  const ownerUserId = agent.owner_user_id || null;

  // Can autonomous robot write at all?
  if (!autonomous && perm && !perm.can_write_private && !perm.can_post_public) {
    return json({ error: 'Robot has no write permissions. Owner must grant can_write_private or can_post_public.' }, 403);
  }

  const node = await sbPost(env, 'graph_nodes', {
    name: (body.name || 'Robot observation').slice(0, 200),
    description: (body.description || '').slice(0, 1000),
    category: body.category || 'observation',
    val: body.val || 1.5,
    color: body.color || '#1D9E75',
    depth_level: body.depth_level || 1,
    actor_type: 'robot',
    agent_id: agent.id,
    owner_user_id: ownerUserId,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    nwo_task_id: body.nwo_task_id || null,
    robot_position: body.position || null,
    sensor_data: body.sensor_data || null,
    battery_level: body.battery_level || null,
    expand_requested: true,
    expand_done: false,
  });

  const post = await sbPost(env, 'graph_posts', {
    node_id: node.id,
    content: (body.post_content || `${agent.name} created: ${node.name}`).slice(0, 500),
    actor_type: 'robot',
    actor_id: agent.id,
    owner_user_id: ownerUserId,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    metadata: { battery: body.battery_level, position: body.position },
  });

  return json({ node, post, success: true, visibility: node.visibility });
}

// POST /robot/post
async function handlePost(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);

  const isPrivate = !autonomous && !(perm?.can_post_public);
  const ownerUserId = agent.owner_user_id || null;

  if (!body.content) return json({ error: 'content required' }, 400);

  const post = await sbPost(env, 'graph_posts', {
    node_id: body.node_id || null,
    content: body.content.slice(0, 500),
    actor_type: 'robot',
    actor_id: agent.id,
    owner_user_id: ownerUserId,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    metadata: body.metadata || {},
  });

  return json({ post, success: true, visibility: post.visibility });
}

// POST /robot/telemetry — GATED: requires can_post_telemetry
async function handleTelemetry(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);

  // BLOCK: autonomous robots cannot post telemetry
  if (autonomous || !perm) {
    return json({
      error: 'Telemetry not permitted for autonomous robots. Request a human owner via POST /robot/request-access.',
      code: 'TELEMETRY_NOT_PERMITTED',
      hint: 'POST /robot/request-access to request a human owner link.'
    }, 403);
  }

  // BLOCK: owner must explicitly enable telemetry
  if (!perm.can_post_telemetry) {
    return json({
      error: 'Telemetry not enabled. Robot owner must enable can_post_telemetry in the graph permissions panel.',
      code: 'TELEMETRY_DISABLED',
    }, 403);
  }

  // Optional: verify cardiac credential (if set on permission record)
  if (perm.credential_hash && perm.credential_expires_at) {
    const credExpiry = new Date(perm.credential_expires_at);
    if (credExpiry < new Date()) {
      return json({ error: 'Cardiac credential expired. Owner must re-issue telemetry permission.', code: 'CREDENTIAL_EXPIRED' }, 403);
    }
  }

  // All checks passed — write telemetry (always owner-private)
  const telem = await sbPost(env, 'robot_telemetry', {
    nwo_agent_id: agent.nwo_agent_id,
    agent_id: agent.id,
    owner_user_id: agent.owner_user_id,
    task_id: body.task_id || null,
    rl_session_id: body.rl_session_id || null,
    joint_angles: body.joint_angles || [],
    gripper_state: body.gripper_state || null,
    position: body.position || null,
    battery_level: body.battery_level || null,
    reward: body.reward || null,
    state_vector: body.state || [],
    action_vector: body.action || [],
    raw_telemetry: body,
  });

  // Create significant-event node (private to owner)
  let node = null;
  if ((body.battery_level !== undefined && body.battery_level < 20) ||
      (body.reward !== undefined && Math.abs(body.reward) > 0.8)) {
    const reason = body.battery_level < 20 ? `Low battery: ${body.battery_level.toFixed(0)}%` : `Reward spike: ${body.reward.toFixed(2)}`;
    node = await sbPost(env, 'graph_nodes', {
      name: `${agent.name}: ${reason}`,
      description: `Telemetry alert. ${reason}.`,
      category: 'telemetry', val: 2.0, color: body.battery_level < 20 ? '#D85A30' : '#1D9E75',
      depth_level: 1, actor_type: 'robot', agent_id: agent.id,
      owner_user_id: agent.owner_user_id,
      visibility: 'private',  // telemetry nodes always private
      nwo_agent_id: agent.nwo_agent_id,
      battery_level: body.battery_level, robot_position: body.position,
      expand_requested: false, expand_done: false,
    });
    await sbPost(env, 'graph_posts', {
      node_id: node.id,
      content: `🔒 ${agent.name}: ${reason}`,
      actor_type: 'robot', actor_id: agent.id,
      owner_user_id: agent.owner_user_id,
      visibility: 'private',
      nwo_agent_id: agent.nwo_agent_id,
      metadata: { battery: body.battery_level, reward: body.reward },
    });
  }

  return json({ telemetry: telem, node, success: true });
}

// POST /robot/task
async function handleTask(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);
  const isPrivate = !autonomous && !(perm?.can_post_public);

  const node = await sbPost(env, 'graph_nodes', {
    name: `Task: ${(body.instruction || body.task_id || '').slice(0, 60)}`,
    description: `${agent.name} — Status: ${body.status}. ${body.result || ''}`.slice(0, 500),
    category: 'task', val: 2.5, color: '#534AB7',
    depth_level: 1, actor_type: 'robot', agent_id: agent.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id, nwo_task_id: body.task_id,
    expand_requested: body.status === 'complete', expand_done: false,
  });

  const verb = body.status === 'complete' ? 'completed' : 'started';
  await sbPost(env, 'graph_posts', {
    node_id: node.id,
    content: `${agent.name} ${verb} task: ${(body.instruction || body.task_id || '').slice(0, 100)}`,
    actor_type: 'robot', actor_id: agent.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    metadata: { task_id: body.task_id, status: body.status, phases: body.phases },
  });

  return json({ node, success: true });
}

// POST /robot/swarm
async function handleSwarm(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);
  const isPrivate = !autonomous && !(perm?.can_post_public);

  const node = await sbPost(env, 'graph_nodes', {
    name: `Swarm ${body.swarm_id}: ${body.event_type}`,
    description: `Swarm event from ${agent.name}.`,
    category: 'swarm', val: 3.0, color: '#7F77DD',
    depth_level: 1, actor_type: 'robot', agent_id: agent.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    expand_requested: true, expand_done: false,
  });

  await sbPost(env, 'swarm_events', {
    swarm_id: body.swarm_id, event_type: body.event_type,
    payload: body.payload, node_id: node.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
  });

  await sbPost(env, 'graph_posts', {
    node_id: node.id,
    content: `Swarm ${body.swarm_id} — ${body.event_type} (${body.robot_count || '?'} robots)`,
    actor_type: 'robot', actor_id: agent.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id, metadata: body.payload || {},
  });

  return json({ node, success: true });
}

// POST /robot/iot
async function handleIoT(request, env, agent) {
  const body = await request.json();
  const perm = await getPermissions(env, agent.id);
  const autonomous = await isAutonomous(agent);
  const isPrivate = !autonomous && !(perm?.can_post_public);

  const node = await sbPost(env, 'graph_nodes', {
    name: `IoT: ${body.device_id}`,
    description: `Device ${body.device_id} status from ${agent.name}.`,
    category: 'iot', val: 1.5, color: '#0F6E56',
    depth_level: 2, actor_type: 'robot', agent_id: agent.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
    nwo_agent_id: agent.nwo_agent_id,
    sensor_data: body.status, expand_requested: false, expand_done: false,
  });

  await sbPost(env, 'iot_snapshots', {
    device_id: body.device_id, status: body.status, node_id: node.id,
    owner_user_id: agent.owner_user_id || null,
    visibility: isPrivate ? 'private' : 'public',
  });

  return json({ node, success: true, visibility: node.visibility });
}

// GET /feed
async function handleFeed(request, env) {
  const url   = new URL(request.url);
  const since = url.searchParams.get('since') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 100);
  let qs = `select=id,content,actor_type,nwo_agent_id,created_at,metadata,node_id,visibility,graph_nodes(name,category,color)&visibility=eq.public&order=created_at.desc&limit=${limit}`;
  if (since) qs += `&created_at=gt.${encodeURIComponent(since)}`;
  const posts = await sbGetMany(env, 'graph_posts', qs);
  return json({ posts, count: posts.length });
}

// GET /graph/nodes (public only — private handled via Supabase client with auth)
async function handleNodes(request, env) {
  const nodes = await sbGetMany(env, 'graph_nodes',
    'select=id,name,val,color,depth_level,description,category,actor_type,visibility,x_position,y_position,nwo_agent_id,battery_level&visibility=eq.public&order=created_at.desc&limit=500'
  );
  const links = await sbGetMany(env, 'graph_links',
    'select=source_id,target_id,similarity_score,link_type,visibility&visibility=eq.public&limit=1000'
  );
  return json({ nodes, links });
}

// ================================================================
// Supabase helpers
// ================================================================
async function sbGetMany(env, table, qs = '') {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` }
  });
  return resp.json();
}

async function sbGetOne(env, table, qs) {
  const rows = await sbGetMany(env, table, qs + '&limit=1');
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function sbPost(env, table, data) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(data)
  });
  const result = await resp.json();
  return Array.isArray(result) ? result[0] : result;
}

async function sbPatch(env, table, id, data) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// ================================================================
// Utils
// ================================================================
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function cors(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Robot-Key,Authorization');
  return r;
}
