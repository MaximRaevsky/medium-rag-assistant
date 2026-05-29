export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1>Medium Article RAG Assistant</h1>
      <p>This service exposes two endpoints:</p>
      <ul>
        <li>
          <code>POST /api/prompt</code> &mdash; ask a question about the Medium articles dataset
        </li>
        <li>
          <code>GET /api/stats</code> &mdash; current RAG configuration
        </li>
      </ul>
    </main>
  );
}
