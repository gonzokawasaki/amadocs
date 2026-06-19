// Ask the dev engine a question and print the RAW streamed model answer (pre-UI-trim).
// Usage: node ask.js <workspace-slug> "<question>"
const slug = process.argv[2];
const message = process.argv[3];
(async () => {
  const res = await fetch(`http://localhost:3001/api/workspace/${slug}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId: crypto.randomUUID() }),
  });
  let text = "";
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop();
    for (const line of parts) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      try {
        const j = JSON.parse(m[1]);
        if (j.textResponse) text += j.textResponse;
      } catch {}
    }
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  console.log(`RAW ANSWER (${words} words):\n` + text);
})();
