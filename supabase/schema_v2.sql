-- ================================================================
-- NWO Agent Graph v2 — Full Schema
-- Includes: cardiac identity, robot ownership, privacy, permissions
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------
CREATE TYPE actor_type       AS ENUM ('human', 'agent', 'robot', 'cron');
CREATE TYPE node_category    AS ENUM ('topic','event','observation','task','inference','sensor','swarm','iot','telemetry');
CREATE TYPE trust_level      AS ENUM ('public','trusted','restricted');
CREATE TYPE registration_mode AS ENUM ('autonomous','owner_registered','owner_invited');
CREATE TYPE request_status   AS ENUM ('pending','approved','denied','revoked');
CREATE TYPE visibility       AS ENUM ('public','private','shared');
CREATE TYPE credential_type  AS ENUM ('task_auth','swarm_cmd','capability','access','telemetry_publish','graph_write');

-- ----------------------------------------------------------------
-- User profiles (extends Supabase auth.users)
-- Cardiac identity lives here
-- ----------------------------------------------------------------
CREATE TABLE user_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        TEXT,
  avatar_label        TEXT,                    -- 2-char display
  wallet_address      TEXT,                    -- Ethereum wallet (Base mainnet)
  root_token_id       TEXT,                    -- NWO soul-bound NFT identity
  cardiac_hash        TEXT,                    -- Latest ECG cardiac hash
  cardiac_verified_at TIMESTAMPTZ,             -- When ECG was last verified
  cardiac_device_type TEXT,                    -- 'apple_watch'|'wear_os'|'fitbit'
  is_cardiac_verified BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- Agents (AI agents + NWO robots)
-- ----------------------------------------------------------------
CREATE TABLE agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  agent_type          TEXT NOT NULL,   -- robot_controller|autonomous_robot|ai_agent|cron
  description         TEXT,
  capabilities        TEXT[],
  wallet_address      TEXT,
  nwo_agent_id        TEXT UNIQUE,     -- NWO platform agent_id
  nwo_api_key         TEXT,            -- hashed in prod; plaintext here for dev
  root_token_id       TEXT,            -- NWO on-chain identity for robots
  owner_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_mode   registration_mode DEFAULT 'autonomous',
  trust_level         trust_level DEFAULT 'public',
  persona_color       TEXT DEFAULT '#D85A30',
  avatar_label        TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_owner   ON agents(owner_user_id);
CREATE INDEX idx_agents_nwo_id  ON agents(nwo_agent_id);
CREATE INDEX idx_agents_active  ON agents(is_active);

-- ----------------------------------------------------------------
-- Robot permissions  (human → robot grant)
-- Uses NWO Cardiac credentials for sensitive operations
-- ----------------------------------------------------------------
CREATE TABLE robot_permissions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id                UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  -- What the robot can do
  can_post_public         BOOLEAN DEFAULT FALSE,  -- post to public graph
  can_post_telemetry      BOOLEAN DEFAULT FALSE,  -- telemetry specifically gated
  can_read_private        BOOLEAN DEFAULT TRUE,   -- see owner's private graph
  can_write_private       BOOLEAN DEFAULT TRUE,   -- write to owner's private graph
  can_act_autonomously    BOOLEAN DEFAULT FALSE,  -- no per-action approval needed
  -- Cardiac credential link (NWO Relayer issued credential)
  credential_hash         TEXT,                   -- keccak256 of issued credential
  credential_expires_at   TIMESTAMPTZ,            -- auto-expire
  cardiac_verified        BOOLEAN DEFAULT FALSE,  -- owner used cardiac to grant
  granted_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_user_id, agent_id)
);

CREATE INDEX idx_perms_owner ON robot_permissions(owner_user_id);
CREATE INDEX idx_perms_agent ON robot_permissions(agent_id);

-- ----------------------------------------------------------------
-- Robot access requests (autonomous robot → requests human owner)
-- ----------------------------------------------------------------
CREATE TABLE robot_access_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nwo_agent_id    TEXT NOT NULL,
  robot_name      TEXT NOT NULL,
  agent_id        UUID REFERENCES agents(id),
  requested_by    TEXT,           -- self-description from robot
  capabilities    TEXT[],
  status          request_status DEFAULT 'pending',
  owner_user_id   UUID REFERENCES auth.users(id),  -- set when approved
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_requests_status ON robot_access_requests(status);
CREATE INDEX idx_requests_owner  ON robot_access_requests(owner_user_id);

-- ----------------------------------------------------------------
-- Cardiac credential log (issued via NWO Relayer)
-- Tracks every credential issue/use for audit
-- ----------------------------------------------------------------
CREATE TABLE cardiac_credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_user_id      UUID REFERENCES auth.users(id),
  recipient_agent_id  UUID REFERENCES agents(id),
  credential_type     credential_type NOT NULL,
  credential_hash     TEXT NOT NULL,
  root_token_id       TEXT,
  relayer_tx          TEXT,            -- relayer response tx/id
  expires_at          TIMESTAMPTZ,
  is_revoked          BOOLEAN DEFAULT FALSE,
  context_data        JSONB,           -- task_id, node_id, etc.
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creds_issuer    ON cardiac_credentials(issuer_user_id);
CREATE INDEX idx_creds_recipient ON cardiac_credentials(recipient_agent_id);
CREATE INDEX idx_creds_hash      ON cardiac_credentials(credential_hash);

-- ----------------------------------------------------------------
-- Graph nodes
-- ----------------------------------------------------------------
CREATE TABLE graph_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id),
  agent_id        UUID REFERENCES agents(id),
  name            TEXT NOT NULL,
  val             FLOAT DEFAULT 1.0,
  color           TEXT,
  depth_level     INT DEFAULT 0,
  description     TEXT,
  category        node_category DEFAULT 'topic',
  actor_type      actor_type DEFAULT 'human',
  -- Privacy
  visibility      visibility DEFAULT 'public',
  owner_user_id   UUID REFERENCES auth.users(id),
  -- Position
  x_position      FLOAT,
  y_position      FLOAT,
  -- Expansion
  expand_requested BOOLEAN DEFAULT FALSE,
  expand_done      BOOLEAN DEFAULT FALSE,
  -- NWO robot metadata
  nwo_agent_id    TEXT,
  nwo_task_id     TEXT,
  robot_position  JSONB,
  sensor_data     JSONB,
  battery_level   FLOAT,
  -- Cardiac credential that authorized this node
  auth_credential_hash TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nodes_actor      ON graph_nodes(actor_type);
CREATE INDEX idx_nodes_agent      ON graph_nodes(agent_id);
CREATE INDEX idx_nodes_owner      ON graph_nodes(owner_user_id);
CREATE INDEX idx_nodes_visibility ON graph_nodes(visibility);
CREATE INDEX idx_nodes_expand     ON graph_nodes(expand_requested) WHERE expand_done = FALSE;
CREATE INDEX idx_nodes_created    ON graph_nodes(created_at DESC);

-- ----------------------------------------------------------------
-- Graph links
-- ----------------------------------------------------------------
CREATE TABLE graph_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id             UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  similarity_score      FLOAT DEFAULT 0.5,
  link_type             TEXT DEFAULT 'semantic',
  visibility            visibility DEFAULT 'public',
  created_by_actor_type actor_type DEFAULT 'human',
  created_by_id         UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_links_source ON graph_links(source_id);
CREATE INDEX idx_links_target ON graph_links(target_id);

-- ----------------------------------------------------------------
-- Social feed posts
-- ----------------------------------------------------------------
CREATE TABLE graph_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  actor_type      actor_type DEFAULT 'human',
  actor_id        UUID,
  nwo_agent_id    TEXT,
  parent_post_id  UUID REFERENCES graph_posts(id),
  visibility      visibility DEFAULT 'public',
  owner_user_id   UUID REFERENCES auth.users(id),
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_created    ON graph_posts(created_at DESC);
CREATE INDEX idx_posts_node       ON graph_posts(node_id);
CREATE INDEX idx_posts_actor      ON graph_posts(actor_type);
CREATE INDEX idx_posts_visibility ON graph_posts(visibility);
CREATE INDEX idx_posts_owner      ON graph_posts(owner_user_id);

-- ----------------------------------------------------------------
-- Robot telemetry (ALWAYS private by default)
-- ----------------------------------------------------------------
CREATE TABLE robot_telemetry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nwo_agent_id    TEXT NOT NULL,
  agent_id        UUID REFERENCES agents(id),
  owner_user_id   UUID REFERENCES auth.users(id),  -- always set; telemetry is owner-only
  task_id         TEXT,
  rl_session_id   TEXT,
  joint_angles    FLOAT[],
  gripper_state   FLOAT,
  position        JSONB,
  battery_level   FLOAT,
  reward          FLOAT,
  state_vector    FLOAT[],
  action_vector   FLOAT[],
  raw_telemetry   JSONB,
  node_id         UUID REFERENCES graph_nodes(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_telemetry_agent   ON robot_telemetry(nwo_agent_id);
CREATE INDEX idx_telemetry_owner   ON robot_telemetry(owner_user_id);
CREATE INDEX idx_telemetry_created ON robot_telemetry(created_at DESC);

-- ----------------------------------------------------------------
-- Swarm events
-- ----------------------------------------------------------------
CREATE TABLE swarm_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swarm_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  node_id       UUID REFERENCES graph_nodes(id),
  owner_user_id UUID REFERENCES auth.users(id),
  visibility    visibility DEFAULT 'public',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- IoT snapshots
-- ----------------------------------------------------------------
CREATE TABLE iot_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     TEXT NOT NULL,
  status        JSONB NOT NULL,
  node_id       UUID REFERENCES graph_nodes(id),
  owner_user_id UUID REFERENCES auth.users(id),
  visibility    visibility DEFAULT 'public',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- BitNet expansion queue
-- ----------------------------------------------------------------
CREATE TABLE expansion_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      UUID NOT NULL REFERENCES graph_nodes(id),
  model_used   TEXT DEFAULT 'BitNet-b1.58-2B-4T',
  prompt_used  TEXT,
  result_raw   TEXT,
  status       TEXT DEFAULT 'pending',
  error_msg    TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cardiac_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_telemetry    ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE iot_snapshots      ENABLE ROW LEVEL SECURITY;

-- ---- user_profiles ----
CREATE POLICY "users read own profile"
  ON user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "users update own profile"
  ON user_profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "users insert own profile"
  ON user_profiles FOR INSERT WITH CHECK (id = auth.uid());

-- ---- agents ----
CREATE POLICY "public read agents"
  ON agents FOR SELECT USING (TRUE);
CREATE POLICY "service role write agents"
  ON agents FOR INSERT WITH CHECK (TRUE);  -- enforced by server, not client
CREATE POLICY "owner update agent"
  ON agents FOR UPDATE USING (owner_user_id = auth.uid());

-- ---- robot_permissions ----
CREATE POLICY "owner reads own permissions"
  ON robot_permissions FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "owner writes own permissions"
  ON robot_permissions FOR INSERT WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "owner updates own permissions"
  ON robot_permissions FOR UPDATE USING (owner_user_id = auth.uid());
CREATE POLICY "owner deletes own permissions"
  ON robot_permissions FOR DELETE USING (owner_user_id = auth.uid());

-- ---- robot_access_requests ----
CREATE POLICY "public insert requests"
  ON robot_access_requests FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "owner reads own requests"
  ON robot_access_requests FOR SELECT
  USING (owner_user_id = auth.uid() OR owner_user_id IS NULL);
CREATE POLICY "owner updates requests"
  ON robot_access_requests FOR UPDATE USING (owner_user_id = auth.uid());

-- ---- cardiac_credentials ----
CREATE POLICY "owner reads own credentials"
  ON cardiac_credentials FOR SELECT USING (issuer_user_id = auth.uid());
CREATE POLICY "service role write credentials"
  ON cardiac_credentials FOR INSERT WITH CHECK (TRUE);

-- ---- graph_nodes ----
CREATE POLICY "read public nodes"
  ON graph_nodes FOR SELECT
  USING (visibility = 'public');

CREATE POLICY "read own private nodes"
  ON graph_nodes FOR SELECT
  USING (owner_user_id = auth.uid());

CREATE POLICY "insert nodes"
  ON graph_nodes FOR INSERT WITH CHECK (TRUE);  -- server stamps owner

CREATE POLICY "update own nodes"
  ON graph_nodes FOR UPDATE
  USING (owner_user_id = auth.uid() OR user_id = auth.uid());

-- ---- graph_links ----
CREATE POLICY "read public links"
  ON graph_links FOR SELECT USING (visibility = 'public');
CREATE POLICY "read private links"
  ON graph_links FOR SELECT
  USING (
    visibility = 'private' AND
    EXISTS (
      SELECT 1 FROM graph_nodes n
      WHERE n.id = graph_links.source_id
        AND n.owner_user_id = auth.uid()
    )
  );
CREATE POLICY "insert links"
  ON graph_links FOR INSERT WITH CHECK (TRUE);

-- ---- graph_posts ----
CREATE POLICY "read public posts"
  ON graph_posts FOR SELECT USING (visibility = 'public');
CREATE POLICY "read own private posts"
  ON graph_posts FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "insert posts"
  ON graph_posts FOR INSERT WITH CHECK (TRUE);

-- ---- robot_telemetry (always owner-only) ----
CREATE POLICY "owner reads telemetry"
  ON robot_telemetry FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "service inserts telemetry"
  ON robot_telemetry FOR INSERT WITH CHECK (TRUE);

-- ---- swarm_events ----
CREATE POLICY "read public swarm events"
  ON swarm_events FOR SELECT USING (visibility = 'public');
CREATE POLICY "read own swarm events"
  ON swarm_events FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "insert swarm events"
  ON swarm_events FOR INSERT WITH CHECK (TRUE);

-- ---- iot_snapshots ----
CREATE POLICY "read public iot"
  ON iot_snapshots FOR SELECT USING (visibility = 'public');
CREATE POLICY "read own iot"
  ON iot_snapshots FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "insert iot"
  ON iot_snapshots FOR INSERT WITH CHECK (TRUE);

-- ================================================================
-- TRIGGER: auto-create user_profile on signup
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- FUNCTIONS
-- ================================================================

-- Check if agent has permission from owner
CREATE OR REPLACE FUNCTION check_robot_permission(
  p_agent_id UUID,
  p_permission TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_result BOOLEAN;
BEGIN
  EXECUTE format(
    'SELECT %I FROM robot_permissions WHERE agent_id = $1 LIMIT 1',
    p_permission
  ) INTO v_result USING p_agent_id;
  RETURN COALESCE(v_result, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
