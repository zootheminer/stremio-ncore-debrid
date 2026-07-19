#!/usr/bin/env bash
PROJECT_DIR="$HOME/.hermes/projects/stremio-ncore-debrid"

# 1. Folyamat leállítása (ha van)
PID=$(ss -ltnp | grep :7000 | awk '{print $7}' | cut -d= -f2 | cut -d, -f1)
if [ -n "$PID" ]; then
    echo "Leállítom a futó folyamatot: $PID"
    kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
fi

# 2. Várjon egy pillanatot, hogy a port szabaduljon fel
sleep 1

# 3. Indítás háttérben, naplózás
echo "Indítom a szerveret..."
cd "$PROJECT_DIR"
nohup node index.js > service.log 2>&1 &
echo "Szerver indulás alatt. Napló: $PROJECT_DIR/service.log"

