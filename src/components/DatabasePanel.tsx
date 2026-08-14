import type { DatabaseInfo } from '../types';

interface DatabasePanelProps {
  databases: DatabaseInfo[];
  loading: boolean;
}

const platformLabel = {
  amiga: 'Amiga',
  atari: 'Atari ST',
  both: 'Both',
};

export function DatabasePanel({ databases, loading }: DatabasePanelProps) {
  if (loading) {
    return <section className="panel databases-panel"><p className="muted">Loading databases…</p></section>;
  }

  return (
    <section className="panel databases-panel">
      <header className="panel-header">
        <h2>Connected Databases</h2>
        <p className="muted">Music libraries powering this player</p>
      </header>
      <div className="database-grid">
        {databases.map((db) => (
          <article key={db.id} className={`database-card ${db.connected ? 'connected' : 'disconnected'}`}>
            <div className="database-card-top">
              <span className={`status-dot ${db.connected ? 'on' : 'off'}`} />
              <h3>{db.name}</h3>
            </div>
            <p>{db.description}</p>
            <div className="database-meta">
              <span className="chip">{platformLabel[db.platform]}</span>
              {db.stats && <span className="chip subtle">{db.stats}</span>}
              {db.requiresKey && <span className="chip warn">API key</span>}
            </div>
            <a href={db.url} target="_blank" rel="noreferrer" className="database-link">
              Visit archive →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
