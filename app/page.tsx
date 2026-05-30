"use client";

import { useEffect, useState } from "react";

type ContextItem = {
  article_id: string;
  title: string;
  chunk: string;
  score: number;
};

type PromptResponse = {
  response: string;
  context: ContextItem[];
};

type Stats = {
  chunk_size: number;
  overlap_ratio: number;
  top_k: number;
};

function excerpt(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PromptResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStats(s))
      .catch(() => {});
  }, []);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!r.ok) {
        let msg = `Request failed (${r.status}).`;
        try {
          const body = await r.json();
          if (body?.error) msg = String(body.error);
        } catch {
          // keep default message
        }
        throw new Error(msg);
      }
      setData((await r.json()) as PromptResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
        color: "#1a1a1a",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Medium Article RAG Assistant</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Ask a question answered strictly from the Medium articles dataset.
      </p>

      {stats && (
        <p style={{ fontSize: 13, color: "#777", marginTop: 0 }}>
          config — chunk_size: {stats.chunk_size}, overlap_ratio: {stats.overlap_ratio}, top_k:{" "}
          {stats.top_k}
        </p>
      )}

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
        }}
        placeholder="e.g. List exactly 3 articles about education. Return only the titles."
        rows={3}
        style={{
          width: "100%",
          padding: 10,
          fontSize: 15,
          fontFamily: "inherit",
          border: "1px solid #ccc",
          borderRadius: 6,
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />

      <div style={{ marginTop: 8 }}>
        <button
          onClick={ask}
          disabled={loading || question.trim() === ""}
          style={{
            padding: "8px 16px",
            fontSize: 15,
            borderRadius: 6,
            border: "1px solid #1a1a1a",
            background: loading || question.trim() === "" ? "#e5e5e5" : "#1a1a1a",
            color: loading || question.trim() === "" ? "#888" : "#fff",
            cursor: loading || question.trim() === "" ? "default" : "pointer",
          }}
        >
          {loading ? "Searching…" : "Ask"}
        </button>
      </div>

      {error && (
        <p style={{ color: "#b00020", marginTop: 16 }} role="alert">
          {error}
        </p>
      )}

      {data && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 17 }}>Answer</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 15,
              background: "#f7f7f7",
              border: "1px solid #eee",
              borderRadius: 6,
              padding: 12,
              margin: 0,
            }}
          >
            {data.response}
          </pre>

          {data.context?.length > 0 && (
            <>
              <h2 style={{ fontSize: 17, marginTop: 24 }}>
                Retrieved context ({data.context.length})
              </h2>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {data.context.map((c, i) => (
                  <li
                    key={`${c.article_id}-${i}`}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 6,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong style={{ fontSize: 14 }}>{c.title}</strong>
                      <span style={{ fontSize: 13, color: "#777", whiteSpace: "nowrap" }}>
                        score {c.score.toFixed(4)}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: "#555", margin: "6px 0 0" }}>
                      {excerpt(c.chunk)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
