#!/usr/bin/env bash
# GPU thermal watchdog for the AMAdocs backfill.
#
# Why: this is a fan-stop laptop dGPU (GTX 1650 Ti) whose fan the OS can't control, run
# in a hot sub-tropical room. The summary backfill fires one granite /generate per doc,
# pinning the GPU. The throttle (GNOME_SYNC_COOLDOWN_MS / GNOME_SYNC_CAP) lowers the duty
# cycle; this watchdog is the HARD backstop: if the GPU still climbs past CEILING it
# SIGSTOPs every ollama process (instantly freezing GPU compute), then SIGCONTs them once
# it cools back below RESUME. A frozen /generate just makes the in-flight HTTP request
# wait — it resumes cleanly, no corruption, worst case one summary is retried next sync.
#
# Tunables (env):
CEILING="${CEILING:-80}"     # °C — freeze ollama at/above this
RESUME="${RESUME:-70}"       # °C — un-freeze once back at/below this
INTERVAL="${INTERVAL:-5}"    # seconds between reads
LOG="${LOG:-$(dirname "$0")/logs/tempguard.log}"
mkdir -p "$(dirname "$LOG")"

paused=0
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
log "tempguard up: CEILING=${CEILING}C RESUME=${RESUME}C every ${INTERVAL}s"

while true; do
  t=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
  if [ -z "$t" ]; then log "WARN: no GPU reading"; sleep "$INTERVAL"; continue; fi
  u=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)

  if [ "$paused" -eq 0 ] && [ "$t" -ge "$CEILING" ]; then
    pkill -STOP -x ollama && paused=1
    log "🔴 ${t}C >= ${CEILING}C — FROZE ollama (util was ${u}%)"
  elif [ "$paused" -eq 1 ] && [ "$t" -le "$RESUME" ]; then
    pkill -CONT -x ollama && paused=0
    log "🟢 ${t}C <= ${RESUME}C — RESUMED ollama"
  else
    log "ok ${t}C util=${u}% paused=${paused}"
  fi
  sleep "$INTERVAL"
done
