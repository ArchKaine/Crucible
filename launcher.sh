#!/bin/bash -l

# Force load environment variables for GUI launchers
source ~/.bashrc 2>/dev/null || true
source ~/.profile 2>/dev/null || true

# Anchor the script to its own directory
cd "$(dirname "$0")" || exit 1

PID_FILE=".crucible.pid"
ENV_FILE=".env"

# Auto-generate the environment file if it is missing
if [ ! -f "$ENV_FILE" ]; then
    echo "[CRUCIBLE] Generating default .env configuration..."
    cat <<ENVEOF > "$ENV_FILE"
CRUCIBLE_PORT=3000
LMS_PORT=1234
LMS_MODEL="cognitivecomputations_dolphin-mistral-24b-venice-edition"
EMBED_MODEL="text-embedding-nomic-embed-text-v2-moe"
ENVEOF
fi

# Export variables so child processes (Node) inherit them
set -a
source "$ENV_FILE"
set +a

start_forge() {
    echo "[CRUCIBLE] Initiating detached launch sequence..."

    # 1. PRE-FLIGHT: Orbital Strike on previous instances & orphans
    echo "[CRUCIBLE] Sweeping sector for orphaned processes..."
    rm -f "$PID_FILE"
    
    pkill -f "node server.js" 2>/dev/null || true
    killall -9 ForgeShell 2>/dev/null || true
    killall -9 dotnet 2>/dev/null || true
    
    # Guarantee Target Port is clear
    if lsof -Pi :${CRUCIBLE_PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        lsof -Pi :${CRUCIBLE_PORT} -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    fi

    # 2. START AI SERVER
    echo "[CRUCIBLE] Booting LM Studio Server on port ${LMS_PORT}..."
    lms server start > crucible-ai.log 2>&1 &
    LMS_PID=$!
    sleep 2 

    # 3. VERIFY & LOAD MODEL
    if ! curl -s http://127.0.0.1:${LMS_PORT}/v1/models | grep -q "$LMS_MODEL"; then
        echo "[CRUCIBLE] Loading $LMS_MODEL into memory..."
        lms load "$LMS_MODEL" > /dev/null 2>&1
    fi

    # 4. START NODE BACKEND
    echo "[CRUCIBLE] Igniting Node.js Backend..."
    node server.js > crucible-node.log 2>&1 &
    NODE_PID=$!
    sleep 1

    # 5. START NATIVE SHELL
    echo "[CRUCIBLE] Launching Native UI..."
    cd ForgeShell || exit
    dotnet run > ../crucible-shell.log 2>&1 &
    DOTNET_PID=$!
    cd ..

    # 6. WRITE STATE TO DISK
    echo "$LMS_PID $NODE_PID $DOTNET_PID" > "$PID_FILE"
    
    echo ""
    echo "[CRUCIBLE] All systems online in background."
}

stop_forge() {
    cd "$(dirname "$0")" || exit 1
    echo "[CRUCIBLE] Shutting down Forge systems..."
    
    # 1. Graceful AI shutdown
    lms server stop >/dev/null 2>&1
    lms unload "$LMS_MODEL" >/dev/null 2>&1

    # 2. Aggressive process termination
    pkill -f "node server.js" 2>/dev/null || true
    killall -9 ForgeShell 2>/dev/null || true
    killall -9 dotnet 2>/dev/null || true
    
    # 3. Port fail-safe
    if lsof -Pi :${CRUCIBLE_PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        lsof -Pi :${CRUCIBLE_PORT} -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    fi

    rm -f "$PID_FILE"

    echo "[CRUCIBLE] All systems offline."
}

# --- CLI ROUTER ---
case "$1" in
    start)
        start_forge
        ;;
    stop)
        stop_forge
        ;;
    restart)
        stop_forge
        sleep 2
        start_forge
        ;;
    *)
        echo "Usage: ./launcher.sh {start|stop|restart}"
        exit 1
esac
