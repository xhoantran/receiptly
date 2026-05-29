"use client";

import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const SUGGESTIONS = [
  "What did I buy at Publix?",
  "How much have I saved with deals?",
  "Find my milk purchases",
  "What do I buy most often?",
];

export function AgentChat() {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMsgs((m) => [...m, { role: "assistant", content: data.text ?? data.error ?? "…", tools: data.tools }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: "Something went wrong reaching the agent." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 grid h-14 w-14 place-items-center rounded-full bg-sprout text-2xl shadow-pop transition-transform hover:scale-105"
        aria-label="Open assistant"
      >
        ✨
      </button>
    );
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[360px] shrink-0 flex-col border-l border-line/70 bg-cream/30 lg:flex">
      <header className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-grape/15 text-lg">✨</span>
          <div>
            <p className="font-display text-lg font-semibold leading-none text-ink">Sprout</p>
            <p className="mt-0.5 text-[12px] text-muted">your receipts, answered</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          ✕
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        {msgs.length === 0 && (
          <div className="rounded-3xl border border-line bg-surface/70 p-5">
            <p className="text-[15px] leading-relaxed text-ink-soft">
              Hi! I can see every item on every receipt I&apos;ve fetched. Ask me anything about what
              you buy.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-pill border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-sprout hover:text-sprout-deep"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[88%] rounded-3xl px-4 py-3 text-[14px] leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-lg bg-ink text-paper"
                  : "rounded-bl-lg border border-line bg-surface text-ink"
              }`}
            >
              {m.tools && m.tools.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span key={j} className="rounded-pill bg-sprout-soft px-2 py-0.5 text-[11px] font-semibold text-sprout-deep">
                      ⚙ {t}
                    </span>
                  ))}
                </div>
              )}
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-3">
              <span className="inline-flex gap-1">
                <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-line/70 p-4"
      >
        <div className="flex items-center gap-2 rounded-pill border border-line bg-surface px-2 py-1.5 shadow-soft focus-within:border-sprout">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your spending…"
            className="flex-1 bg-transparent px-3 text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="grid h-9 w-9 place-items-center rounded-full bg-sprout text-paper transition-transform enabled:hover:scale-105 disabled:opacity-40"
          >
            ↑
          </button>
        </div>
      </form>
    </aside>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-muted"
      style={{ animation: `pop 0.6s ${delay}s infinite alternate ease-in-out` }}
    />
  );
}
