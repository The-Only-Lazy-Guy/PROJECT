# Graph-Agent Frontend

React + Python API frontend for the `graph_v5` OpenCode/V4 demo path.

This project is intentionally separate from the backend reasoning work. It reads
graphs from `../graph_v5`, calls the V4 OpenCode controller, and records
finalized demo/test runs into the V5 distillation corpus.

## Prerequisites

Install API dependencies in the existing Python environment:

```powershell
pip install -r requirements-api.txt
```

Install web dependencies:

```powershell
npm.cmd install
```

Make sure the `opencode` command is on `PATH`. By default the API runs:

```powershell
opencode run --attach http://localhost:6767 -
```

Override these if your OpenCode setup differs:

```powershell
$env:OPENCODE_COMMAND = "opencode"
$env:OPENCODE_ATTACH_URL = "http://localhost:6767"
$env:OPENCODE_TIMEOUT = "240"
```

Set `OPENCODE_ATTACH_URL` to an empty string if your OpenCode configuration
does not use `--attach`.

Reasoning path toggle:

```powershell
$env:REASONING_MODE = "v4"        # default OpenCode/V4 demo path
$env:REASONING_MODE = "legacy"    # one-shot graph prompt path
$env:REASONING_MODE = "substrate" # Phase-1 reasoning-loop path
```

Backend and corpus defaults:

```powershell
$env:GRAPH_BACKEND_DIR = "E:\PROJECT\graph_v5"
$env:GRAPH_GRAPH_DIR = "E:\PROJECT\graph_v5\graphs"
$env:GRAPH_CORPUS_ROOT = "E:\PROJECT\graph_v5\data\distillation_corpus"
$env:GRAPH_CORPUS_FILE = "sessions.jsonl"
```

The demo API passes `collect_corpus=True` into `graph_v5.answerer_v4`.
Finalized V4/OpenCode runs append to:

```text
E:\PROJECT\graph_v5\data\distillation_corpus\sessions.jsonl
```

Session subgraphs default to:

```text
E:\PROJECT\graph_v5\data\session_subgraphs
```

## Run

Terminal 1:

```powershell
.\run_api.bat
```

Terminal 2:

```powershell
.\run_web.bat
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Architecture

- `api/frontend_api.py` exposes `/api/health`, `/api/graphs`, and `/api/runs`.
- `/api/health` reports the active backend, graph directory, corpus path, and
  whether V4 demo runs are collecting corpus rows.
- `POST /api/runs/stream` streams run status events and returns the final
  OpenCode answer payload, including the corpus target metadata.
- The API serializes the selected graph with node IDs, node types, edge
  relations, and top retrieved anchors before calling OpenCode.
- The React app calls only the API. It never loads the model and never imports
  `transformers`, `torch`, `llama_cpp`, or a local `llama-server`.
- Chat history is browser-only for v1.

The live trace is public prompt/run metadata, not hidden private
chain-of-thought.
