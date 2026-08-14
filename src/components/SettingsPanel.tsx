import {
  MACHINE_BLURBS,
  MACHINE_IDS,
  MACHINE_LABELS,
  type MachineId,
  type MachineSettings,
  enabledMachines,
} from '../utils/machines';

interface SettingsPanelProps {
  machines: MachineSettings;
  onToggle: (id: MachineId) => void;
  onEnableAll: () => void;
}

export function SettingsPanel({ machines, onToggle, onEnableAll }: SettingsPanelProps) {
  const active = enabledMachines(machines);
  const alone = active.length === 1 ? active[0] : null;

  return (
    <>
      <header className="panel-header settings-header">
        <div>
          <h2>Settings</h2>
          <p className="muted">
            Choose which machines are included by default in Library search, Insights, and “All
            platforms”.
          </p>
        </div>
        <button type="button" className="settings-reset" onClick={onEnableAll} disabled={active.length === MACHINE_IDS.length}>
          Enable all
        </button>
      </header>

      <ul className="settings-machine-list" aria-label="Default machines">
        {MACHINE_IDS.map((id) => {
          const checked = machines[id];
          const lockedOn = alone === id;
          return (
            <li key={id}>
              <label className={`settings-machine-row${checked ? ' is-on' : ''}`} data-platform={id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={lockedOn}
                  aria-label={`${MACHINE_LABELS[id]}${lockedOn ? ' (at least one machine required)' : ''}`}
                  onChange={() => onToggle(id)}
                />
                <span className="settings-machine-copy">
                  <strong>{MACHINE_LABELS[id]}</strong>
                  <span className="muted">{MACHINE_BLURBS[id]}</span>
                </span>
                <span className={`platform-badge settings-machine-badge`} data-platform={id}>
                  {id.toUpperCase()}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="settings-footnote muted">
        {active.length === MACHINE_IDS.length
          ? 'All machines are enabled.'
          : `${active.map((id) => MACHINE_LABELS[id]).join(' · ')} enabled by default.`}
        {alone ? ' Keep at least one machine on.' : ''}
      </p>
    </>
  );
}
