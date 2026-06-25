import { SERVICES, SERVICE_NAMES } from "@sagemark/core";

const service = SERVICES.intelligence;

export default function Home() {
  const siblings = SERVICE_NAMES.filter((n) => n !== service.name).map(
    (n) => SERVICES[n],
  );

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 12, opacity: 0.6 }}>
        Sagemark Service
      </p>
      <h1 style={{ fontSize: 36, fontWeight: 700, marginTop: 8 }}>{service.title}</h1>
      <p style={{ fontSize: 18, opacity: 0.8, marginTop: 12 }}>{service.description}</p>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6 }}>
          Endpoints
        </h2>
        <ul style={{ marginTop: 12, lineHeight: 1.9 }}>
          <li><code>GET /api/health</code> — liveness + version</li>
          <li><code>POST /api/run</code> — primary action (stub)</li>
        </ul>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6 }}>
          Sister services
        </h2>
        <ul style={{ marginTop: 12, lineHeight: 1.9 }}>
          {siblings.map((s) => (
            <li key={s.name}>
              <strong>{s.title}</strong> — {s.description}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
