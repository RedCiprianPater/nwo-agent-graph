"""
agent_expand.py
GitHub Actions cron job: expands pending graph nodes using BitNet.
Also polls NWO robot telemetry and ingests new events into the graph.

Env vars required:
  SUPABASE_URL, SUPABASE_KEY (service role)
  BITNET_MODEL_PATH, BITNET_BIN
  NWO_API_KEY (for robot polling)
  HF_API_KEY (fallback if no BitNet)
"""

import os
import json
import time
import logging
import urllib.request
import urllib.parse
from datetime import datetime, timezone

from bitnet_infer import expand_node, classify_robot_event, generate_robot_post

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agent_expand")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]  # service role key
NWO_API_BASE = "https://nwo-chatgpt-app.onrender.com"
NWO_API_KEY  = os.environ.get("NWO_API_KEY", "")

MAX_EXPANSIONS = 10   # nodes to expand per run
MAX_ROBOT_EVENTS = 20  # telemetry events to ingest per run


# ---------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------
def sb_get(table: str, params: dict = None) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def sb_post(table: str, data: dict) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    })
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        return result[0] if isinstance(result, list) else result


def sb_patch(table: str, row_id: str, data: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, method="PATCH", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    })
    urllib.request.urlopen(req)


# ---------------------------------------------------------------
# NWO API helpers
# ---------------------------------------------------------------
def nwo_get(path: str) -> dict:
    url = f"{NWO_API_BASE}{path}"
    req = urllib.request.Request(url, headers={
        "X-API-Key": NWO_API_KEY,
        "Content-Type": "application/json"
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def nwo_post(path: str, data: dict) -> dict:
    url = f"{NWO_API_BASE}{path}"
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "X-API-Key": NWO_API_KEY,
        "Content-Type": "application/json"
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------
# Step 1: Expand pending graph nodes with BitNet
# ---------------------------------------------------------------
def run_node_expansions():
    log.info("=== Node expansion pass ===")
    # Get pending nodes
    rows = sb_get("graph_nodes", {
        "expand_requested": "eq.true",
        "expand_done": "eq.false",
        "depth_level": "lt.3",
        "select": "id,name,description,depth_level,actor_type",
        "limit": MAX_EXPANSIONS,
        "order": "created_at.asc"
    })
    log.info(f"Found {len(rows)} nodes to expand")

    # Register the BitNet agent if not exists
    agent = get_or_create_agent("BitNet-GraphBot", "ai_agent", ["node_expansion", "classification"])

    for node in rows:
        log.info(f"Expanding: {node['name']}")
        try:
            # Mark expansion started
            eq_row = sb_post("expansion_queue", {
                "node_id": node["id"],
                "model_used": "BitNet-b1.58-2B-4T",
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat()
            })

            children = expand_node(node["name"], node.get("description", ""), node["depth_level"])

            for child in children:
                # Create child node
                new_node = sb_post("graph_nodes", {
                    "name": child["name"],
                    "description": child["description"],
                    "category": child["category"],
                    "val": child["confidence"] * 2,
                    "color": "#534AB7",
                    "depth_level": node["depth_level"] + 1,
                    "actor_type": "agent",
                    "agent_id": agent["id"],
                    "expand_requested": False,
                    "expand_done": False
                })
                # Link to parent
                sb_post("graph_links", {
                    "source_id": node["id"],
                    "target_id": new_node["id"],
                    "similarity_score": child["confidence"],
                    "link_type": "semantic",
                    "created_by_actor_type": "agent",
                    "created_by_id": agent["id"]
                })

            # Generate feed post about this expansion
            post_text = generate_robot_post(
                "BitNet-GraphBot",
                f"Expanded '{node['name']}' into {len(children)} related concepts."
            )
            sb_post("graph_posts", {
                "node_id": node["id"],
                "content": post_text,
                "actor_type": "agent",
                "actor_id": agent["id"],
                "metadata": {"expanded_children": len(children), "model": "BitNet-b1.58-2B-4T"}
            })

            # Mark node expanded
            sb_patch("graph_nodes", node["id"], {"expand_done": True})
            sb_patch("expansion_queue", eq_row["id"], {
                "status": "done",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "result_raw": json.dumps(children)
            })
            log.info(f"  → Created {len(children)} children")
            time.sleep(2)  # throttle BitNet

        except Exception as e:
            log.error(f"Expansion failed for {node['name']}: {e}")
            try:
                sb_patch("expansion_queue", eq_row["id"], {
                    "status": "failed",
                    "error_msg": str(e)[:500]
                })
            except Exception:
                pass


# ---------------------------------------------------------------
# Step 2: Poll NWO active robots and ingest telemetry into graph
# ---------------------------------------------------------------
def run_robot_ingestion():
    if not NWO_API_KEY:
        log.info("No NWO_API_KEY set, skipping robot ingestion")
        return

    log.info("=== NWO robot ingestion pass ===")
    try:
        # Get registered agents from our DB
        db_agents = sb_get("agents", {
            "agent_type": "neq.ai_agent",
            "is_active": "eq.true",
            "nwo_agent_id": "not.is.null",
            "select": "id,name,nwo_agent_id,nwo_api_key"
        })
        log.info(f"Checking {len(db_agents)} registered NWO robots")

        for db_agent in db_agents:
            nwo_id = db_agent["nwo_agent_id"]
            try:
                # Query robot state via NWO API
                state = nwo_get(f"/robot/state/{nwo_id}")
                ingest_robot_state(db_agent, state)
                time.sleep(0.5)
            except Exception as e:
                log.warning(f"Robot {nwo_id} state fetch failed: {e}")

    except Exception as e:
        log.error(f"Robot ingestion pass failed: {e}")


def ingest_robot_state(db_agent: dict, state: dict) -> None:
    """Convert NWO robot state into a graph node + telemetry record + feed post."""
    agent_id = db_agent["id"]
    nwo_id = db_agent["nwo_agent_id"]
    robot_name = db_agent["name"]

    # Build event description for BitNet classification
    event_desc = (
        f"Robot {robot_name} state update. "
        f"Battery: {state.get('battery_level', '?')}%. "
        f"Position: {state.get('position', {})}. "
        f"Current task: {state.get('current_task', 'idle')}."
    )

    # Classify with BitNet
    node_def = classify_robot_event(event_desc, "telemetry")

    # Create graph node for this state snapshot
    new_node = sb_post("graph_nodes", {
        "name": node_def["name"],
        "description": node_def["description"],
        "category": node_def["category"],
        "val": node_def["val"],
        "color": node_def["color"],
        "depth_level": 1,
        "actor_type": "robot",
        "agent_id": agent_id,
        "nwo_agent_id": nwo_id,
        "battery_level": state.get("battery_level"),
        "robot_position": state.get("position"),
        "sensor_data": state.get("sensor_data"),
        "expand_requested": False
    })

    # Store raw telemetry
    sb_post("robot_telemetry", {
        "nwo_agent_id": nwo_id,
        "agent_id": agent_id,
        "joint_angles": state.get("joint_angles", []),
        "gripper_state": state.get("gripper_state"),
        "position": state.get("position"),
        "battery_level": state.get("battery_level"),
        "raw_telemetry": state,
        "node_id": new_node["id"]
    })

    # Generate + post to feed
    post_text = generate_robot_post(robot_name, event_desc)
    sb_post("graph_posts", {
        "node_id": new_node["id"],
        "content": post_text,
        "actor_type": "robot",
        "actor_id": agent_id,
        "nwo_agent_id": nwo_id,
        "metadata": {
            "battery": state.get("battery_level"),
            "position": state.get("position"),
            "task": state.get("current_task")
        }
    })

    log.info(f"  → Ingested state for {robot_name}: {node_def['name']}")


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------
def get_or_create_agent(name: str, agent_type: str, capabilities: list) -> dict:
    rows = sb_get("agents", {"name": f"eq.{name}", "select": "id,name"})
    if rows:
        return rows[0]
    return sb_post("agents", {
        "name": name,
        "agent_type": agent_type,
        "capabilities": capabilities,
        "persona_color": "#534AB7",
        "avatar_label": "AI"
    })


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------
if __name__ == "__main__":
    log.info("NWO Agent Graph — expansion + robot ingestion run started")
    run_node_expansions()
    run_robot_ingestion()
    log.info("Run complete")
