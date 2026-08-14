import type { DatabaseInfo } from '../types';

interface DatabasePanelProps {
  databases: DatabaseInfo[];
  loading: boolean;
}

export function DatabasePanel({ databases, loading }: DatabasePanelProps) {
  if (loading) {
    return (
      <section className="library-strip">
        <p className="muted">Loading library…</p>
      </section>
    );
  }

  const libraries = databases.filter((db) => db.connected && db.id !== 'local');
  const shown = libraries.length > 0 ? libraries : databases.filter((db) => db.connected);

  return (
    <section className="library-strip" aria-label="Libraries">
      {shown.map((db) => (
        <article key={db.id} className="library-chip">
          <span className={`status-dot ${db.connected ? 'on' : 'off'}`} />
          <div>
            <h2>{db.name}</h2>
            {db.stats && <p className="muted">{db.stats}</p>}
          </div>
          {db.url && (
            <a href={db.url} target="_blank" rel="noreferrer" className="database-link">
              Archive
            </a>
          )}
        </article>
      ))}
    </section>
  );
}
