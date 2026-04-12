/**
 * cardiacApi.js
 * NWO Cardiac SDK integration for the Agent Graph frontend.
 *
 * Handles:
 *  - ECG validation via Oracle
 *  - Identity registration/lookup via Relayer
 *  - Credential issuance for robot permissions
 *  - Credential verification before sensitive ops
 *
 * Live services:
 *  Oracle:  https://nwo-oracle.onrender.com
 *  Relayer: https://nwo-relayer.onrender.com
 */

const ORACLE_URL  = import.meta.env.VITE_CARDIAC_ORACLE_URL  || 'https://nwo-oracle.onrender.com';
const RELAYER_URL = import.meta.env.VITE_CARDIAC_RELAYER_URL || 'https://nwo-relayer.onrender.com';

// NWO Base Mainnet contract addresses
export const CONTRACTS = {
  identityRegistry:   '0x78455AFd5E5088F8B5fecA0523291A75De1dAfF8',
  accessController:   '0x29d177bedaef29304eacdc63b2d0285c459a0f50',
  paymentProcessor:   '0x4afa4618bb992a073dbcfbddd6d1aebc3d5abd7c',
  chainId: 8453,  // Base mainnet
};

// Credential type hashes (keccak256 of type names)
export const CREDENTIAL_TYPES = {
  TASK_AUTH:         '0x' + 'task_auth',
  GRAPH_WRITE:       '0x' + 'graph_write',
  TELEMETRY_PUBLISH: '0x' + 'telemetry_publish',
  SWARM_CMD:         '0x' + 'swarm_cmd',
  ACCESS:            '0x' + 'access',
};

// ---------------------------------------------------------------
// Internal fetch helpers
// ---------------------------------------------------------------
async function oracleFetch(path, body, secret = '') {
  const resp = await fetch(`${ORACLE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Oracle-Secret': secret || import.meta.env.VITE_ORACLE_SECRET || '',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Oracle ${path}: ${resp.status} ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function relayerFetch(path, body, secret = '') {
  const resp = await fetch(`${RELAYER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Relayer-Secret': secret || import.meta.env.VITE_RELAYER_SECRET || '',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Relayer ${path}: ${resp.status} ${err.slice(0, 200)}`);
  }
  return resp.json();
}

async function relayerGet(path, secret = '') {
  const resp = await fetch(`${RELAYER_URL}${path}`, {
    headers: { 'X-Relayer-Secret': secret || import.meta.env.VITE_RELAYER_SECRET || '' },
  });
  if (!resp.ok) throw new Error(`Relayer GET ${path}: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------
// Oracle endpoints
// ---------------------------------------------------------------
export const cardiac = {

  async oracleHealth() {
    try {
      const r = await fetch(`${ORACLE_URL}/health`);
      return r.json();
    } catch {
      return { status: 'unreachable' };
    }
  },

  async relayerHealth() {
    try {
      const r = await fetch(`${RELAYER_URL}/health`);
      return r.json();
    } catch {
      return { status: 'unreachable' };
    }
  },

  /**
   * Validate ECG data from a smart watch.
   * Returns { cardiacHash, valid, confidence }
   *
   * @param {string} walletAddress - User's Ethereum wallet
   * @param {number[]} rrIntervals - RR intervals in ms (from watch)
   * @param {string} deviceType    - 'apple_watch' | 'wear_os' | 'fitbit'
   */
  async validateECG(walletAddress, rrIntervals, deviceType = 'apple_watch') {
    return oracleFetch('/oracle/validate', {
      wallet: walletAddress,
      ecgData: { rrIntervals, deviceType },
    });
  },

  /**
   * Compute cardiac hash without full validation (faster, for demos).
   */
  async hashECG(rrIntervals, deviceType = 'apple_watch') {
    return oracleFetch('/oracle/hashECG', {
      ecgData: { rrIntervals, deviceType },
    });
  },

  /**
   * Check if a cardiac hash was recently validated (in-memory oracle cache).
   */
  async verifyRecentECG(cardiacHash) {
    return oracleFetch('/oracle/verify', { cardiacHash });
  },

  // ---------------------------------------------------------------
  // Human Identity Registration
  // ---------------------------------------------------------------

  /**
   * Full human registration flow:
   * 1. Validate ECG → get cardiacHash
   * 2. Get nonce from relayer
   * 3. Sign EIP-712 message (via MetaMask/wallet)
   * 4. Submit to relayer → get rootTokenId
   *
   * Returns { rootTokenId, cardiacHash, walletAddress }
   */
  async registerHuman(walletAddress, rrIntervals, deviceType = 'apple_watch', signFn) {
    // Step 1: validate ECG
    const { cardiacHash } = await cardiac.validateECG(walletAddress, rrIntervals, deviceType);
    if (!cardiacHash) throw new Error('ECG validation failed — no cardiac hash returned');

    // Step 2: get nonce
    const { nonce } = await relayerFetch('/relay/nonce', { wallet: walletAddress });

    // Step 3: sign EIP-712
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const signature = await signFn({
      domain: { name: 'NWOIdentity', version: '1', chainId: CONTRACTS.chainId, verifyingContract: CONTRACTS.identityRegistry },
      types: {
        Register: [
          { name: 'wallet', type: 'address' },
          { name: 'cardiacHash', type: 'bytes32' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ]
      },
      value: { wallet: walletAddress, cardiacHash, nonce, deadline }
    });

    // Step 4: submit to relayer (gasless)
    const result = await relayerFetch('/relay/selfRegisterHuman', {
      wallet: walletAddress,
      cardiacHash,
      deadline,
      userSig: signature,
    });

    return { rootTokenId: result.rootTokenId, cardiacHash, walletAddress };
  },

  /**
   * Identify a user by their cardiac hash (heartbeat login).
   */
  async identifyByCardiac(cardiacHash) {
    return relayerFetch('/read/identifyByCardiac', { cardiacHash });
  },

  /**
   * Identify a user by their agent API key (for robots).
   */
  async identifyByAgentKey(hashedApiKey) {
    return relayerFetch('/read/identifyByAgentKey', { hashedApiKey });
  },

  // ---------------------------------------------------------------
  // Robot/Agent Registration
  // ---------------------------------------------------------------

  /**
   * Register an AI agent or robot on-chain via Relayer.
   */
  async registerAgent(agentName, agentType = 'robot_controller', walletAddress = null) {
    return relayerFetch('/relay/registerAgent', {
      agent_name: agentName,
      agent_type: agentType,
      wallet_address: walletAddress,
    });
  },

  // ---------------------------------------------------------------
  // Credential Issuance (for robot permissions)
  // ---------------------------------------------------------------

  /**
   * Issue a credential to a robot (e.g. telemetry_publish, graph_write).
   * Requires human owner to have a valid rootTokenId.
   *
   * @param {string} humanRootTokenId  - Owner's soul-bound token
   * @param {string} credentialType    - from CREDENTIAL_TYPES
   * @param {string} credentialHash    - keccak256 of what's being authorized
   * @param {number} expiresInSeconds  - default 24h
   */
  async issueCredential(humanRootTokenId, credentialType, credentialHash, expiresInSeconds = 86400) {
    return relayerFetch('/relay/issueCredential', {
      rootTokenId: humanRootTokenId,
      credentialType,
      credentialHash,
      expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
  },

  /**
   * Grant location/robot access credential.
   */
  async grantAccess(humanRootTokenId, targetIdentity, durationSeconds = 86400) {
    return relayerFetch('/relay/grantAccess', {
      rootTokenId: humanRootTokenId,
      targetIdentity,
      duration: durationSeconds,
    });
  },

  // ---------------------------------------------------------------
  // Credential Verification
  // ---------------------------------------------------------------

  /**
   * Check if a robot has a valid credential of a given type.
   */
  async hasValidCredential(rootTokenId, credentialType) {
    return relayerFetch('/read/hasValidCredential', { rootTokenId, credentialType });
  },

  /**
   * Check location access (for NWO access control integration).
   */
  async checkAccess(rootTokenId, locationId) {
    return relayerFetch('/access/check', { rootTokenId, locationId });
  },

  // ---------------------------------------------------------------
  // Enrollment
  // ---------------------------------------------------------------

  /**
   * Enroll additional cardiac hash for existing identity.
   */
  async enrollCardiac(rootTokenId, newCardiacHash) {
    return relayerFetch('/relay/enrollCardiac', { rootTokenId, cardiacHash: newCardiacHash });
  },

  // ---------------------------------------------------------------
  // Payment
  // ---------------------------------------------------------------
  async processPayment(rootTokenId, terminalId, amount) {
    return relayerFetch('/payment/process', { rootTokenId, terminalId, amount });
  },

  // ---------------------------------------------------------------
  // Helpers for the graph system
  // ---------------------------------------------------------------

  /**
   * Issue a "telemetry_publish" credential to a robot.
   * Called when human owner grants telemetry posting rights.
   */
  async grantTelemetryPublish(humanRootTokenId, robotNwoAgentId, expiresInSeconds = 86400 * 30) {
    const credHash = await simpleHash(`telemetry_publish:${robotNwoAgentId}:${Date.now()}`);
    return cardiac.issueCredential(
      humanRootTokenId,
      CREDENTIAL_TYPES.TELEMETRY_PUBLISH,
      credHash,
      expiresInSeconds
    );
  },

  /**
   * Issue a "graph_write" credential to a robot.
   */
  async grantGraphWrite(humanRootTokenId, robotNwoAgentId, isPublic = false) {
    const credHash = await simpleHash(`graph_write:${robotNwoAgentId}:public=${isPublic}:${Date.now()}`);
    return cardiac.issueCredential(
      humanRootTokenId,
      CREDENTIAL_TYPES.GRAPH_WRITE,
      credHash,
      86400 * 30
    );
  },

  /**
   * Verify a task auth credential before robot executes.
   */
  async verifyTaskAuth(robotRootTokenId, taskId) {
    const credHash = await simpleHash(`task_auth:${taskId}`);
    return cardiac.hasValidCredential(robotRootTokenId, CREDENTIAL_TYPES.TASK_AUTH);
  },
};

// ---------------------------------------------------------------
// Simple hash helper (no ethers.js dependency)
// ---------------------------------------------------------------
async function simpleHash(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return '0x' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default cardiac;
