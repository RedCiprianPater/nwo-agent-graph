/**
 * nwoApi.js — NWO Robotics API client
 * Wraps all NWO Robotics endpoints and bridges data into the graph.
 * Used by the React frontend to: read robot states, trigger actions,
 * and pipe results into the graph via the Worker API.
 */

const NWO_BASE = import.meta.env.VITE_NWO_BASE || 'https://nwo-chatgpt-app.onrender.com';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------
async function nwoFetch(path, options = {}) {
  const apiKey = localStorage.getItem('nwo_api_key') || '';
  const resp = await fetch(`${NWO_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...(options.headers || {})
    }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`NWO API ${path}: ${resp.status} ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function workerPost(path, data) {
  const robotKey = localStorage.getItem('robot_api_key') || '';
  const resp = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Robot-Key': robotKey
    },
    body: JSON.stringify(data)
  });
  return resp.json();
}

// ---------------------------------------------------------------
// Discovery & Health
// ---------------------------------------------------------------
export const nwo = {

  async health() {
    return nwoFetch('/discovery/health');
  },

  async whoami() {
    return nwoFetch('/discovery/whoami');
  },

  async capabilities() {
    return nwoFetch('/discovery/capabilities');
  },

  // ---------------------------------------------------------------
  // Agent / Robot Registration
  // ---------------------------------------------------------------
  async registerAgent(name, agentType = 'robot_controller', capabilities = [], walletAddress = '') {
    // Register with NWO platform
    const nwoResult = await nwoFetch('/agents/register', {
      method: 'POST',
      body: JSON.stringify({ agent_name: name, agent_type: agentType, capabilities, wallet_address: walletAddress })
    });
    // Also register in our graph Worker
    const graphResult = await workerPost('/robot/register', {
      nwo_agent_id: nwoResult.agent_id,
      name,
      agent_type: agentType,
      capabilities,
      wallet_address: walletAddress
    });
    return { nwo: nwoResult, graph: graphResult };
  },

  async listRobots() {
    return nwoFetch('/robots/list');
  },

  async getRobotStatus(agentId) {
    return nwoFetch(`/robot/status/${agentId}`);
  },

  // ---------------------------------------------------------------
  // Robot State — query joint angles, gripper, position, battery
  // ---------------------------------------------------------------
  async queryRobotState(agentId, includeImage = false) {
    const state = await nwoFetch(`/robot/state/${agentId}?include_image=${includeImage}`);
    // Pipe into graph worker
    await workerPost('/robot/telemetry', {
      joint_angles: state.joint_angles,
      gripper_state: state.gripper_state,
      position: state.position,
      battery_level: state.battery_level
    }).catch(() => {});  // non-blocking
    return state;
  },

  // ---------------------------------------------------------------
  // VLA Inference
  // ---------------------------------------------------------------
  async inference(instruction, images = [], modelId = null, agentId = null) {
    const body = { instruction };
    if (images.length > 0) body.images = images;
    if (modelId) body.model_id = modelId;
    if (agentId) body.agent_id = agentId;
    body.use_model_router = !modelId;
    return nwoFetch('/inference', { method: 'POST', body: JSON.stringify(body) });
  },

  async edgeInference(instruction, images = []) {
    return nwoFetch('/inference/edge', {
      method: 'POST',
      body: JSON.stringify({ instruction, images })
    });
  },

  // ---------------------------------------------------------------
  // Task Planning — creates a graph node automatically
  // ---------------------------------------------------------------
  async planTask(instruction, robotId = null, executionMode = 'mock') {
    const plan = await nwoFetch('/tasks/plan', {
      method: 'POST',
      body: JSON.stringify({ instruction, robot_id: robotId, execution_mode: executionMode })
    });
    // Create graph node for this task
    await workerPost('/robot/task', {
      task_id: plan.task_id,
      instruction,
      status: 'planned',
      phases: plan.phases
    }).catch(() => {});
    return plan;
  },

  async executeSubtask(taskId, subtaskIndex) {
    return nwoFetch(`/tasks/${taskId}/subtask/${subtaskIndex}`, { method: 'POST' });
  },

  async pollTaskStatus(agentId, taskId) {
    return nwoFetch(`/tasks/status?agent_id=${agentId}&task_id=${taskId}`);
  },

  async taskHistory(limit = 20) {
    return nwoFetch(`/tasks/history?limit=${limit}`);
  },

  // ---------------------------------------------------------------
  // Execute Actions (low-level joint control)
  // ---------------------------------------------------------------
  async executeActions(agentId, actions, safetyCheck = true, speed = 0.5) {
    const result = await nwoFetch('/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, actions, safety_check: safetyCheck, speed })
    });
    return result;
  },

  // ---------------------------------------------------------------
  // Safety
  // ---------------------------------------------------------------
  async safetyCheck(action, context = {}) {
    return nwoFetch('/safety/check', {
      method: 'POST',
      body: JSON.stringify({ action, context })
    });
  },

  async emergencyStop(robotId) {
    return nwoFetch(`/safety/emergency-stop/${robotId}`, { method: 'POST' });
  },

  async emergencyStopAll() {
    return nwoFetch('/safety/emergency-stop-all', { method: 'POST' });
  },

  // ---------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------
  async simulateTrajectory(trajectory, robotId) {
    return nwoFetch('/simulation/trajectory', {
      method: 'POST',
      body: JSON.stringify({ trajectory, robot_id: robotId })
    });
  },

  async checkCollision(trajectory) {
    return nwoFetch('/simulation/collision', {
      method: 'POST',
      body: JSON.stringify({ trajectory })
    });
  },

  async validateGrasp(graspConfig) {
    return nwoFetch('/simulation/grasp', {
      method: 'POST',
      body: JSON.stringify(graspConfig)
    });
  },

  // ---------------------------------------------------------------
  // Swarm — creates a swarm graph node on broadcast
  // ---------------------------------------------------------------
  async swarmBroadcast(swarmId, message, robotCount = null) {
    const result = await nwoFetch('/swarm/broadcast', {
      method: 'POST',
      body: JSON.stringify({ swarm_id: swarmId, message })
    });
    await workerPost('/robot/swarm', {
      swarm_id: swarmId,
      event_type: 'broadcast',
      payload: message,
      robot_count: robotCount
    }).catch(() => {});
    return result;
  },

  async swarmJoin(swarmId, robotId) {
    const result = await nwoFetch('/swarm/join', {
      method: 'POST',
      body: JSON.stringify({ swarm_id: swarmId, robot_id: robotId })
    });
    await workerPost('/robot/swarm', {
      swarm_id: swarmId,
      event_type: 'join',
      payload: { robot_id: robotId }
    }).catch(() => {});
    return result;
  },

  async swarmLeave(swarmId, robotId) {
    return nwoFetch('/swarm/leave', {
      method: 'POST',
      body: JSON.stringify({ swarm_id: swarmId, robot_id: robotId })
    });
  },

  // ---------------------------------------------------------------
  // IoT — creates an IoT graph node on status fetch
  // ---------------------------------------------------------------
  async iotStatus(deviceId) {
    const status = await nwoFetch(`/iot/status/${deviceId}`);
    await workerPost('/robot/iot', { device_id: deviceId, status }).catch(() => {});
    return status;
  },

  async iotCommand(deviceId, command) {
    return nwoFetch(`/iot/command/${deviceId}`, {
      method: 'POST',
      body: JSON.stringify({ command })
    });
  },

  // ---------------------------------------------------------------
  // Embodiment Registry
  // ---------------------------------------------------------------
  async listEmbodiments(type = null) {
    const qs = type ? `?type=${type}` : '';
    return nwoFetch(`/embodiment/list${qs}`);
  },

  async embodimentDetail(robotType) {
    return nwoFetch(`/embodiment/${robotType}`);
  },

  async embodimentCompare(robotTypes) {
    return nwoFetch('/embodiment/compare', {
      method: 'POST',
      body: JSON.stringify({ robot_types: robotTypes })
    });
  },

  // ---------------------------------------------------------------
  // Telemetry (RL sessions)
  // ---------------------------------------------------------------
  async submitTelemetry(rlSessionId, reward, state = [], action = [], extra = {}) {
    const result = await nwoFetch('/rl/telemetry', {
      method: 'POST',
      body: JSON.stringify({ rl_session_id: rlSessionId, reward, state, action, ...extra })
    });
    // Pipe to graph worker (non-blocking)
    await workerPost('/robot/telemetry', {
      rl_session_id: rlSessionId,
      reward,
      state,
      action,
      ...extra
    }).catch(() => {});
    return result;
  },

  // ---------------------------------------------------------------
  // Sensor fusion
  // ---------------------------------------------------------------
  async sensorFusion(sensorData) {
    return nwoFetch('/sensors/fuse', {
      method: 'POST',
      body: JSON.stringify(sensorData)
    });
  },

  // ---------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------
  async listModels() {
    return nwoFetch('/models/list');
  },

  async getModelInfo(modelId) {
    return nwoFetch(`/models/${modelId}`);
  },

  // ---------------------------------------------------------------
  // Balance / quota
  // ---------------------------------------------------------------
  async balance() {
    return nwoFetch('/agent/balance');
  },
};

export default nwo;
