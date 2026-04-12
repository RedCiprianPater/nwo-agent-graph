/**
 * authApi.js
 * Supabase Auth wrapper — email magic link + cardiac identity.
 * Manages the user session and cardiac verification state.
 */

import { supabase } from './graphApi.js';

// ---------------------------------------------------------------
// Session management
// ---------------------------------------------------------------
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null, session);
  });
}

// ---------------------------------------------------------------
// Email magic link (primary auth — no password needed)
// ---------------------------------------------------------------
export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
  return { sent: true };
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ---------------------------------------------------------------
// User profile (extended with cardiac identity)
// ---------------------------------------------------------------
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Save cardiac identity after successful ECG registration.
 */
export async function saveCardiacIdentity(userId, { cardiacHash, rootTokenId, walletAddress, deviceType }) {
  return updateProfile(userId, {
    cardiac_hash: cardiacHash,
    root_token_id: rootTokenId,
    wallet_address: walletAddress,
    cardiac_device_type: deviceType,
    cardiac_verified_at: new Date().toISOString(),
    is_cardiac_verified: true,
  });
}

// ---------------------------------------------------------------
// Robot permissions (owner manages their robots)
// ---------------------------------------------------------------
export async function getMyRobotPermissions(userId) {
  const { data, error } = await supabase
    .from('robot_permissions')
    .select('*, agents(id,name,nwo_agent_id,agent_type,persona_color,avatar_label,capabilities)')
    .eq('owner_user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function grantRobotPermission(userId, agentId, permissions) {
  const { data, error } = await supabase
    .from('robot_permissions')
    .upsert({
      owner_user_id: userId,
      agent_id: agentId,
      ...permissions,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_user_id,agent_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokeRobotPermission(userId, agentId) {
  const { error } = await supabase
    .from('robot_permissions')
    .delete()
    .eq('owner_user_id', userId)
    .eq('agent_id', agentId);
  if (error) throw error;
}

// ---------------------------------------------------------------
// Robot access requests
// ---------------------------------------------------------------
export async function getPendingRequests(userId) {
  const { data, error } = await supabase
    .from('robot_access_requests')
    .select('*')
    .or(`owner_user_id.eq.${userId},owner_user_id.is.null`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function approveRequest(requestId, userId, permissions = {}) {
  // Get the request
  const { data: req, error: re } = await supabase
    .from('robot_access_requests')
    .update({ status: 'approved', owner_user_id: userId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single();
  if (re) throw re;

  // Link agent to owner
  if (req.agent_id) {
    await supabase
      .from('agents')
      .update({ owner_user_id: userId, registration_mode: 'owner_invited', trust_level: 'trusted' })
      .eq('id', req.agent_id);
  }

  // Create permission record
  if (req.agent_id) {
    await grantRobotPermission(userId, req.agent_id, {
      can_post_public: permissions.can_post_public ?? false,
      can_post_telemetry: permissions.can_post_telemetry ?? false,
      can_read_private: permissions.can_read_private ?? true,
      can_write_private: permissions.can_write_private ?? true,
      can_act_autonomously: permissions.can_act_autonomously ?? false,
    });
  }

  return req;
}

export async function denyRequest(requestId, note = '') {
  const { error } = await supabase
    .from('robot_access_requests')
    .update({ status: 'denied', reviewed_at: new Date().toISOString(), review_note: note })
    .eq('id', requestId);
  if (error) throw error;
}

// ---------------------------------------------------------------
// Cardiac credentials log
// ---------------------------------------------------------------
export async function logCardiacCredential(issuerId, agentId, credentialType, credentialHash, relayerTx, expiresAt) {
  const { data, error } = await supabase
    .from('cardiac_credentials')
    .insert({
      issuer_user_id: issuerId,
      recipient_agent_id: agentId,
      credential_type: credentialType,
      credential_hash: credentialHash,
      relayer_tx: relayerTx,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMyCredentials(userId) {
  const { data, error } = await supabase
    .from('cardiac_credentials')
    .select('*, agents(name,nwo_agent_id)')
    .eq('issuer_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------
// Register a robot as a human (human creates robot record)
// ---------------------------------------------------------------
export async function humanRegisterRobot(userId, { name, nwoAgentId, agentType, capabilities, walletAddress }) {
  // Robot API key
  const apiKey = `nwo_robot_${nwoAgentId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // We call our Worker to create the agent + permission row
  const workerUrl = import.meta.env.VITE_WORKER_URL || '';
  const session = await getSession();

  const resp = await fetch(`${workerUrl}/robot/register-by-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ name, nwo_agent_id: nwoAgentId, agent_type: agentType, capabilities, wallet_address: walletAddress }),
  });

  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Registration failed');
  return result;
}
