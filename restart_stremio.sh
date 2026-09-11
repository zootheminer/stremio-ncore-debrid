#!/usr/bin/env bash
PROJECT_DIR="$HOME/.hermes/projects/stremio-ncore-debrid"

# 1. Folyamat leállítása (ha van)
# Az ss kimenetben a pid a users:(...) mezőben van, ami oszlopszámozástól
# függően $6 vagy $7 is lehet — ezért mezőfüggetlenül, regex-szel szedjük ki.
PID=$(ss -ltnp 2>/dev/null | grep :7000 | grep -oP 'pid=\K[0-9]+' | head -1)
# Fallback: pgrep, ha az ss nem elérhető vagy nem ad pid-et
if [ -z "$PID" ]; then
    PID=$(pgrep -f "node.*stremio-ncore-debrid/index.js" | head -1)
fi
if [ -n "$PID" ]; then
    echo "Leállítom a futó folyamatot: $PID"
    kill "$PID" 2>/dev/null
    # Várunk a rendes leállásra (max ~10 mp), csak utána KILL
    for _ in $(seq 1 10); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
        echo "Kényszerített leállítás: $PID"
        kill -9 "$PID" 2>/dev/null
    fi
fi

# 2. Megvárjuk, hogy a port tényleg felszabaduljon (max ~10 mp)
for _ in $(seq 1 10); do
    ss -ltn 2>/dev/null | grep -q :7000 || break
    sleep 1
done

# 3. Indítás háttérben, naplózás
echo "Indítom a szerveret..."
cd "$PROJECT_DIR"
nohup node index.js > service.log 2>&1 &
echo "Szerver indulás alatt. Napló: $PROJECT_DIR/service.log"

