// Sample the dev engine N times across a few questions and flag instruction-leak markers.
const slug = process.argv[2] || "leakcheck";
const N = Number(process.argv[3] || 6);
const QS = [
  "Who repaired the humidity failure in vault three, and how long did it take?",
  "What is the new classification scheme for manuscripts?",
  "Tell me about the documents.", // vague -> more room to ramble
];
const LEAK = /(##\s*Instruction|Context\s*\d|In your response:|Additional Constraints|Increased difficulty|<\/?document|System:)/i;

async function ask(message) {
  const res = await fetch(`http://localhost:3001/api/workspace/${slug}/stream-chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId: crypto.randomUUID() }),
  });
  let text = "", buf = ""; const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split("\n"); buf = parts.pop();
    for (const line of parts) { const m = line.match(/^data:\s*(.*)$/); if (!m) continue;
      try { const j = JSON.parse(m[1]); if (j.textResponse) text += j.textResponse; } catch {} }
  }
  return text.trim();
}

(async () => {
  let leaks = 0, total = 0, maxWords = 0;
  for (const q of QS) {
    for (let i = 0; i < N; i++) {
      const a = await ask(q);
      const words = a.split(/\s+/).filter(Boolean).length;
      maxWords = Math.max(maxWords, words);
      const leaked = LEAK.test(a);
      if (leaked) { leaks++; console.log(`\n!! LEAK [${q.slice(0,30)}...] (${words}w):\n${a}\n`); }
      total++;
    }
  }
  console.log(`\nSUMMARY: ${leaks}/${total} leaked, max ${maxWords} words.`);
})();
