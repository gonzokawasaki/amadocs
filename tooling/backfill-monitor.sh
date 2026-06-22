#!/usr/bin/env bash
# Polls the gnome-sync state file until the backfill drains (empty-mtime == 0) or timeout.
SF="anythingllm-upstream/server/storage/gnome-sync/amadocs-library.json"
for i in $(seq 1 150); do   # 150 * 120s = 5h max
  PENDING=$(python3 -c "import json;d=json.load(open('$SF'));print(sum(1 for v in d['files'].values() if isinstance(v,dict) and v.get('mtime')==''))" 2>/dev/null)
  DONE=$((778 - PENDING))
  echo "[$(date +%H:%M:%S)] iter $i: pending=$PENDING done≈$DONE/778"
  if [ "$PENDING" = "0" ]; then echo "BACKFILL COMPLETE"; break; fi
  sleep 120
done
