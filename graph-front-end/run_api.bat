@echo off
setlocal
cd /d "%~dp0"

:: Activate the venv if it exists in the parent directory
if exist "..\venv\Scripts\activate.bat" (
    call "..\venv\Scripts\activate.bat"
)

if not defined REASONING_MODE set REASONING_MODE=v4
if not defined GRAPH_BACKEND_DIR set GRAPH_BACKEND_DIR=%~dp0..\graph_v5
set PYTHONPATH=%GRAPH_BACKEND_DIR%;%PYTHONPATH%
python -m uvicorn api.frontend_api:app --host 0.0.0.0 --port 8787
