"""
bitnet_infer.py
Wrapper around BitNet b1.58 inference for the NWO Agent Graph.
Handles: node expansion, intent classification, post generation.

Expects BitNet to be built and model downloaded at MODEL_PATH.
Falls back to HF Inference API if local BitNet unavailable.
"""

import subprocess
import json
import os
import re
import time
import logging
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bitnet_infer")

MODEL_PATH = os.environ.get(
    "BITNET_MODEL_PATH",
    "models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf"
)
BITNET_BIN = os.environ.get("BITNET_BIN", "./build/bin/llama-cli")
HF_API_KEY = os.environ.get("HF_API_KEY", "")
FALLBACK_MODEL = "microsoft/Phi-3-mini-4k-instruct"  # HF fallback, no GPU needed

MAX_RETRIES = 3
INFERENCE_TIMEOUT = 60  # seconds


def _run_bitnet(prompt: str, max_tokens: int = 256, temperature: float = 0.3) -> str:
    """Run inference via local BitNet binary."""
    cmd = [
        BITNET_BIN,
        "-m", MODEL_PATH,
        "-p", prompt,
        "-n", str(max_tokens),
        "--temp", str(temperature),
        "--threads", str(os.cpu_count() or 2),
        "--ctx-size", "2048",
        "--log-disable",
        "-no-cnv",
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=INFERENCE_TIMEOUT
    )
    if result.returncode != 0:
        raise RuntimeError(f"BitNet error: {result.stderr[:300]}")
    # Strip the echoed prompt from output
    output = result.stdout.strip()
    if output.startswith(prompt[:50]):
        output = output[len(prompt):].strip()
    return output


def _run_hf_fallback(prompt: str, max_tokens: int = 256) -> str:
    """Fallback to HF Inference API (no GPU, serverless)."""
    import urllib.request
    url = f"https://api-inference.huggingface.co/models/{FALLBACK_MODEL}"
    payload = json.dumps({
        "inputs": prompt,
        "parameters": {"max_new_tokens": max_tokens, "temperature": 0.3, "return_full_text": False}
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        return data[0]["generated_text"].strip()


def infer(prompt: str, max_tokens: int = 256, temperature: float = 0.3) -> str:
    """Run inference, falling back to HF API if BitNet unavailable."""
    if Path(MODEL_PATH).exists() and Path(BITNET_BIN).exists():
        for attempt in range(MAX_RETRIES):
            try:
                return _run_bitnet(prompt, max_tokens, temperature)
            except Exception as e:
                log.warning(f"BitNet attempt {attempt+1} failed: {e}")
                time.sleep(1)
        raise RuntimeError("BitNet failed after retries")
    elif HF_API_KEY:
        log.info("Using HF Inference API fallback")
        return _run_hf_fallback(prompt, max_tokens)
    else:
        raise RuntimeError("No inference backend available. Set BITNET_MODEL_PATH or HF_API_KEY.")


def _extract_json(text: str) -> dict:
    """Extract first valid JSON object from model output."""
    text = text.strip()
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Find JSON block
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError(f"No valid JSON in output: {text[:200]}")


# ---------------------------------------------------------------
# Task 1: Expand a graph node into related children
# ---------------------------------------------------------------
EXPAND_SYSTEM = """You are a knowledge graph expansion assistant.
Given a topic node, generate exactly 3 related child topics.
Respond ONLY with valid JSON. No explanation, no preamble.
Format:
{
  "children": [
    {"name": "Child Topic 1", "description": "One sentence description.", "category": "topic", "confidence": 0.9},
    {"name": "Child Topic 2", "description": "One sentence description.", "category": "topic", "confidence": 0.8},
    {"name": "Child Topic 3", "description": "One sentence description.", "category": "topic", "confidence": 0.75}
  ]
}
Categories: topic | event | observation | task | inference"""


def expand_node(node_name: str, node_description: str = "", depth: int = 0) -> list[dict]:
    """Expand a graph node using BitNet. Returns list of child dicts."""
    prompt = f"""{EXPAND_SYSTEM}

Parent node: {node_name}
Description: {node_description or 'No description provided.'}
Current depth: {depth}

Generate 3 related child topics:"""

    for attempt in range(MAX_RETRIES):
        try:
            raw = infer(prompt, max_tokens=300, temperature=0.4)
            data = _extract_json(raw)
            children = data.get("children", [])
            if not children:
                raise ValueError("Empty children list")
            # Validate and clean
            valid = []
            for c in children[:3]:
                if "name" in c:
                    valid.append({
                        "name": str(c["name"])[:100],
                        "description": str(c.get("description", ""))[:500],
                        "category": c.get("category", "topic"),
                        "confidence": float(c.get("confidence", 0.7))
                    })
            return valid
        except Exception as e:
            log.warning(f"expand_node attempt {attempt+1}: {e}")
            time.sleep(2)
    return []


# ---------------------------------------------------------------
# Task 2: Classify a robot event into a graph category + name
# ---------------------------------------------------------------
CLASSIFY_SYSTEM = """You are a robot event classifier for a knowledge graph.
Given robot telemetry or an event description, extract a graph node.
Respond ONLY with valid JSON. No explanation.
Format:
{
  "name": "Short node name (max 8 words)",
  "description": "One sentence describing this event.",
  "category": "observation",
  "val": 1.5,
  "color": "#1D9E75"
}
Categories: observation | task | inference | sensor | telemetry | event
Colors: observation=#1D9E75, task=#7F77DD, inference=#534AB7, sensor=#1D9E75, telemetry=#0F6E56, event=#D85A30"""


def classify_robot_event(event_description: str, event_type: str = "telemetry") -> dict:
    """Turn a NWO robot event into a graph node definition."""
    prompt = f"""{CLASSIFY_SYSTEM}

Robot event type: {event_type}
Event data: {event_description[:500]}

Extract graph node:"""

    for attempt in range(MAX_RETRIES):
        try:
            raw = infer(prompt, max_tokens=200, temperature=0.2)
            data = _extract_json(raw)
            return {
                "name": str(data.get("name", f"Robot {event_type}"))[:100],
                "description": str(data.get("description", ""))[:500],
                "category": data.get("category", "observation"),
                "val": float(data.get("val", 1.5)),
                "color": data.get("color", "#1D9E75"),
            }
        except Exception as e:
            log.warning(f"classify_robot_event attempt {attempt+1}: {e}")
            time.sleep(1)
    return {
        "name": f"Robot {event_type} event",
        "description": event_description[:200],
        "category": "observation",
        "val": 1.5,
        "color": "#1D9E75"
    }


# ---------------------------------------------------------------
# Task 3: Generate a social feed post from robot state
# ---------------------------------------------------------------
POST_SYSTEM = """You are a robot posting to a social knowledge graph feed.
Write a short, factual post (1-2 sentences, max 120 characters) describing what you just observed or did.
Respond ONLY with the post text. No quotes, no labels."""


def generate_robot_post(robot_name: str, event_summary: str) -> str:
    """Generate a social feed post from a robot event."""
    prompt = f"""{POST_SYSTEM}

Robot name: {robot_name}
Event: {event_summary[:300]}

Post:"""

    try:
        raw = infer(prompt, max_tokens=80, temperature=0.5)
        # Clean up any quotes or labels
        post = raw.strip().strip('"').strip("'")
        return post[:200]
    except Exception as e:
        log.warning(f"generate_robot_post failed: {e}")
        return f"{robot_name}: {event_summary[:100]}"


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python bitnet_infer.py expand 'Node Name'")
        print("       python bitnet_infer.py classify 'event description'")
        sys.exit(1)
    task = sys.argv[1]
    text = sys.argv[2]
    if task == "expand":
        result = expand_node(text)
        print(json.dumps(result, indent=2))
    elif task == "classify":
        result = classify_robot_event(text)
        print(json.dumps(result, indent=2))
    elif task == "post":
        result = generate_robot_post("TestBot", text)
        print(result)
