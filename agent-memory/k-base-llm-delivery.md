---
name: k-base-llm-delivery
description: K-base LLM delivery decision — bundle Ollama as a silent sidecar
metadata: 
  node_type: memory
  type: project
  originSessionId: 71d9d256-6219-4be6-968a-1c599f54fb4e
---

For [[k-base-project]], the local LLM is delivered by **bundling Ollama as a hidden sidecar** (ship the binary, start/stop it silently, user never sees it). Chosen over embedding node-llama-cpp because: Ollama is proven, AnythingLLM speaks to it natively (zero glue code), has GPU support, and gets us to a demoable product fastest. Can swap to embedded llama.cpp later if needed. First-run flow: silent Ollama start + model download with a progress bar. User approved 2026-06-12 as good for fast prototyping.
