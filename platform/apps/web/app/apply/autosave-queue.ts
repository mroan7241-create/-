export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// One writer; changes made during a PUT are coalesced to the latest UI snapshot.
export function createAutosaveQueue<T>(initial: T, initialRevision: number, save: (snapshot: T) => Promise<number>, notify: (state: SaveState) => void) {
  let current = initial;
  let persisted = JSON.stringify(initial);
  let revision = initialRevision;
  let running: Promise<number> | null = null;
  const isSaved = () => !running && JSON.stringify(current) === persisted;
  return {
    setCurrent(snapshot: T) { current = snapshot; },
    isSaved,
    flush(): Promise<number> {
      if (running) return running;
      if (isSaved()) return Promise.resolve(revision);
      notify('saving');
      running = Promise.resolve().then(async () => {
        while (JSON.stringify(current) !== persisted) {
          const snapshot = current;
          const fingerprint = JSON.stringify(snapshot);
          revision = await save(snapshot);
          persisted = fingerprint;
        }
        return revision;
      }).then((result) => {
        running = null;
        notify(isSaved() ? 'saved' : 'idle');
        return result;
      }, (error: unknown) => {
        running = null;
        notify('error');
        throw error;
      });
      return running;
    },
  };
}
