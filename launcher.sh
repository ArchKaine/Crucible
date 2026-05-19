#!/bin/bash -l

# Force load environment variables for GUI launchers
source ~/.bashrc 2>/dev/null || true
source ~/.profile 2>/dev/null || true

# Anchor the script to its own directory
cd "$(dirname "$0")" || exit 1

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

# Export variables so child processes inherit them
set -a
source "$ENV_FILE"
set +a

start_forge() {
    echo "[CRUCIBLE] Initiating managed launch sequence..."

    # 1. PRE-FLIGHT
    echo "[CRUCIBLE] Sweeping sector..."
    killall -9 ForgeShell 2>/dev/null || true
    killall -9 dotnet 2>/dev/null || true

    # Clear target port if held
    PORT_PID=$(lsof -Pi :${CRUCIBLE_PORT} -sTCP:LISTEN -t)
    if [ ! -z "$PORT_PID" ]; then
        kill -9 $PORT_PID 2>/dev/null || true
    fi

    # 2. START AI SERVER
    echo "[CRUCIBLE] Booting LM Studio Server..."
    lms server start > crucible-ai.log 2>&1 &
    sleep 2

    # 3. VERIFY & LOAD MODEL
    if ! curl -s http://127.0.0.1:${LMS_PORT}/v1/models | grep -q "$LMS_MODEL"; then
        echo "[CRUCIBLE] Loading $LMS_MODEL..."
        lms load "$LMS_MODEL" > /dev/null 2>&1
    fi

    # 4. START NODE BACKEND VIA PM2
    echo "[CRUCIBLE] Igniting Node.js Backend..."
    pm2 start server.js --name "crucible-backend" --output crucible-node.log --error crucible-node.log

    # 5. START NATIVE SHELL
    echo "[CRUCIBLE] Launching Native UI..."
    cd ForgeShell || exit
    dotnet run > ../crucible-shell.log 2>&1 &
    cd ..

    echo "[CRUCIBLE] Systems online."
}

stop_forge() {
    cd "$(dirname "$0")" || exit 1
    echo "[CRUCIBLE] Shutting down..."

    lms server stop >/dev/null 2>&1
    lms unload "$LMS_MODEL" >/dev/null 2>&1
    pm2 delete "crucible-backend" >/dev/null 2>&1
    killall -9 ForgeShell 2>/dev/null || true
    killall -9 dotnet 2>/dev/null || true
}

case "$1" in
    start) start_forge ;;
    stop) stop_forge ;;
    restart) stop_forge; sleep 2; start_forge ;;
    *) echo "Usage: ./launcher.sh {start|stop|restart}"; exit 1 ;;
esac
