#!/usr/bin/env bash
# Live monitor for the AMAdocs backfill: logs GPU + chassis temps + queued count,
# and HARD-STOPs ollama if the CPU package crosses a danger threshold the GPU-only
# tempguard can't see. Safety net for the fan-stop laptop's chassis/battery heat.
PKG_CEIL="${PKG_CEIL:-93}"   # x86_pkg_temp danger ceiling (°C)
PKG_RESUME="${PKG_RESUME:-82}"
INTERVAL="${INTERVAL:-12}"
STATE="/home/user/claude/amadocs-main/anythingllm-upstream/server/storage/gnome-sync/amadocs-library.json"
LOG="/home/user/claude/amadocs-main/tooling/logs/chassis-monitor.log"
paused=0
while true; do
  g=$(nvidia-smi --query-gpu=temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  pkg=$(( $(cat /sys/class/thermal/thermal_zone8/temp 2>/dev/null || echo 0)/1000 ))
  acpi=$(( $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)/1000 ))
  q=$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));let e=0;for(const v of Object.values(j.files||{}))if(!v.mtime)e++;process.stdout.write(""+e)}catch(e){process.stdout.write("?")}' "$STATE")
  if [ "$paused" -eq 0 ] && [ "$pkg" -ge "$PKG_CEIL" ]; then
    pkill -STOP -x ollama && paused=1
    echo "[$(date +%H:%M:%S)] 🔴 CHASSIS pkg=${pkg}C >= ${PKG_CEIL}C — FROZE ollama (gpu=${g} acpi=${acpi} queued=${q})" | tee -a "$LOG"
  elif [ "$paused" -eq 1 ] && [ "$pkg" -le "$PKG_RESUME" ]; then
    pkill -CONT -x ollama && paused=0
    echo "[$(date +%H:%M:%S)] 🟢 CHASSIS pkg=${pkg}C <= ${PKG_RESUME}C — RESUMED ollama" | tee -a "$LOG"
  else
    echo "[$(date +%H:%M:%S)] gpu=${g} pkg=${pkg}C acpi=${acpi}C queued=${q} paused=${paused}" >> "$LOG"
  fi
  sleep "$INTERVAL"
done
