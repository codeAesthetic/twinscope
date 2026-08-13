import { useEffect, useState } from 'react';
import { Button, Chip, FileTypeBadge } from '../components/primitives';
import { badgeForKind } from '../lib/historyView';
import { capturePreset, openSavedComparison } from '../lib/savedComparisons';
import { useAppStore } from '../stores/app';
import { useProjectsStore } from '../stores/projects';
import { useSettingsStore } from '../stores/settings';
import type { Project, SavedComparison } from '../../../shared/channels';

/**
 * Projects (v0.2.9, A19) — scope, presets and ignore rules, and the comparisons
 * saved under them.
 *
 * The screen is deliberately not a wizard. Nothing in TwinScope requires a project:
 * this is somewhere to say "when I compare things here, start with these options",
 * and the *active* project is the only thing that changes any behaviour.
 */
export function ProjectsScreen() {
  const projects = useProjectsStore((state) => state.projects);
  const saved = useProjectsStore((state) => state.saved);
  const loaded = useProjectsStore((state) => state.loaded);
  const refresh = useProjectsStore((state) => state.refresh);
  const save = useProjectsStore((state) => state.save);
  const remove = useProjectsStore((state) => state.remove);
  const setActive = useProjectsStore((state) => state.setActive);
  const activeId = useSettingsStore((state) => state.preferences.activeProjectId ?? null);
  const setNotice = useAppStore((state) => state.setNotice);

  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (): Promise<void> => {
    const name = draft.trim();
    if (name === '') return;
    setDraft('');
    const project = await save({ name });
    // The one a user just made is the one they mean — anything else means creating
    // a project then having to notice a second control before it does anything.
    await setActive(project.id);
  };

  /** A folder scope, chosen with the same picker every other path uses. */
  const chooseRoot = async (project: Project): Promise<void> => {
    const picked = await window.twinscope.dialog.pickFolder('A');
    if (picked?.path === undefined) return;
    await save({
      id: project.id,
      name: project.name,
      root: picked.path,
      presets: project.presets,
      ignores: project.ignores,
    });
  };

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="screen-projects"
    >
      <div className="dd-toolbar">
        <input
          className="dd-inputish"
          placeholder="New project name…"
          value={draft}
          data-testid="project-name"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create();
          }}
        />
        <Button variant="primary" data-testid="project-create" onClick={() => void create()}>
          Create project
        </Button>
        <span className="dd-spacer" />
        {activeId === null ? (
          <Chip>No active project</Chip>
        ) : (
          <Button
            variant="ghost"
            data-testid="project-clear-active"
            onClick={() => void setActive(null)}
          >
            Work without a project
          </Button>
        )}
      </div>

      <div className="dd-projects">
        {loaded && projects.length === 0 && (
          <p className="dd-empty" data-testid="projects-empty">
            No projects yet. A project remembers a folder, the options you like for it, and what to
            ignore — everything works without one.
          </p>
        )}

        {projects.map((project) => {
          const mine = saved.filter((entry) => entry.projectId === project.id);
          const isActive = project.id === activeId;

          return (
            <section
              key={project.id}
              className="dd-project"
              data-testid={`project-${project.id}`}
              data-active={isActive ? 'true' : 'false'}
              aria-labelledby={`project-h-${project.id}`}
            >
              <header className="dd-project-hd">
                <h2 id={`project-h-${project.id}`}>{project.name}</h2>
                {isActive ? (
                  <Chip variant="acc" data-testid={`project-active-${project.id}`}>
                    active
                  </Chip>
                ) : (
                  <Button
                    size="sm"
                    data-testid={`project-activate-${project.id}`}
                    onClick={() => void setActive(project.id)}
                  >
                    Make active
                  </Button>
                )}
                <span className="dd-spacer" />
                {confirming === project.id ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      data-testid={`project-delete-confirm-${project.id}`}
                      onClick={() => {
                        setConfirming(null);
                        void remove(project.id);
                      }}
                    >
                      Delete project
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`project-delete-${project.id}`}
                    onClick={() => setConfirming(project.id)}
                  >
                    Delete
                  </Button>
                )}
              </header>

              <div className="dd-project-row">
                <span className="dd-project-label">Folder</span>
                <code data-testid={`project-root-${project.id}`}>{project.root ?? '—'}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`project-pick-root-${project.id}`}
                  onClick={() => void chooseRoot(project)}
                >
                  {project.root === undefined ? 'Choose…' : 'Change…'}
                </Button>
              </div>

              <div className="dd-project-row">
                <span className="dd-project-label">Always ignore</span>
                <IgnoreList
                  project={project}
                  onChange={(ignores) =>
                    void save({
                      id: project.id,
                      name: project.name,
                      ...(project.root !== undefined ? { root: project.root } : {}),
                      presets: project.presets,
                      ignores,
                    })
                  }
                />
              </div>

              <div className="dd-project-row">
                <span className="dd-project-label">Presets</span>
                <span className="dd-project-presets" data-testid={`project-presets-${project.id}`}>
                  {Object.keys(project.presets).length === 0 ? (
                    <span className="dd-optd">
                      None yet. Run a comparison, set it up how you like it, then capture it here.
                    </span>
                  ) : (
                    Object.entries(project.presets).map(([engineId, options]) => (
                      <Chip key={engineId} variant="info" title={JSON.stringify(options)}>
                        {engineId}: {Object.keys(options).length} option
                        {Object.keys(options).length === 1 ? '' : 's'}
                      </Chip>
                    ))
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`project-capture-${project.id}`}
                  onClick={() =>
                    void capturePreset(project).then((ok) => {
                      if (ok) setNotice(null);
                    })
                  }
                >
                  Capture from current comparison
                </Button>
              </div>

              <SavedList
                entries={mine}
                testId={`project-saved-${project.id}`}
                emptyText="Nothing saved in this project yet — ⌘S in a comparison puts it here."
              />
            </section>
          );
        })}

        {/* Saved comparisons that belong to no project: either saved before one was
            chosen, or left behind when a project was deleted. Deleting a project must
            not delete work done inside it. */}
        <section className="dd-project" data-testid="project-unfiled">
          <header className="dd-project-hd">
            <h2>Not in a project</h2>
          </header>
          <SavedList
            entries={saved.filter((entry) => entry.projectId === undefined)}
            testId="saved-unfiled"
            emptyText="Nothing here."
          />
        </section>
      </div>
    </div>
  );
}

/** Globs, committed on Enter — the same pattern the custom normalisation rules use. */
function IgnoreList({
  project,
  onChange,
}: {
  project: Project;
  onChange: (ignores: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <span className="dd-project-ignores">
      {project.ignores.map((glob) => (
        <Chip key={glob}>
          <code>{glob}</code>
          <button
            type="button"
            aria-label={`Stop ignoring ${glob}`}
            data-testid={`project-unignore-${project.id}-${glob}`}
            onClick={() => onChange(project.ignores.filter((candidate) => candidate !== glob))}
          >
            ✕
          </button>
        </Chip>
      ))}
      <input
        className="dd-inputish"
        placeholder="glob, e.g. dist/**"
        value={draft}
        data-testid={`project-ignore-input-${project.id}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const glob = draft.trim();
          if (glob === '' || project.ignores.includes(glob)) return;
          setDraft('');
          onChange([...project.ignores, glob]);
        }}
      />
    </span>
  );
}

export function SavedList({
  entries,
  testId,
  emptyText,
}: {
  entries: readonly SavedComparison[];
  testId: string;
  emptyText: string;
}) {
  const removeSaved = useProjectsStore((state) => state.removeSaved);

  if (entries.length === 0) return <p className="dd-optd">{emptyText}</p>;

  return (
    <ul className="dd-hlist" data-testid={testId}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="dd-hitem-wrap">
            <button
              type="button"
              className="dd-hitem"
              data-testid={`saved-${entry.id}`}
              onClick={() => void openSavedComparison(entry)}
            >
              <FileTypeBadge kind={badgeForKind(entry.a.kind)} />
              <span className="dd-hitem-col">
                <span className="dd-hitem-name">{entry.name}</span>
                <span className="dd-hitem-path">
                  {entry.a.path ?? entry.a.name} ↔ {entry.b.path ?? entry.b.name}
                </span>
              </span>
              <span className="dd-hitem-chips">
                <Chip variant="info">{entry.engineId}</Chip>
                {Object.keys(entry.options).length > 0 && (
                  <Chip>{Object.keys(entry.options).length} options</Chip>
                )}
              </span>
            </button>
            <span className="dd-hitem-actions">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${entry.name}`}
                data-testid={`saved-delete-${entry.id}`}
                onClick={() => void removeSaved(entry.id)}
              >
                ✕
              </Button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
