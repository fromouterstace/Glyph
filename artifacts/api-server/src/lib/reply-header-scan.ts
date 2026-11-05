export function createHeaderReader<T>(
  load: (id: string) => Promise<T>,
  isCached: (id: string) => boolean,
  limit = 20,
) {
  let remaining = limit;
  return async (id: string): Promise<T | undefined> => {
    if (!isCached(id)) {
      if (remaining === 0) return undefined;
      remaining--;
    }
    return load(id);
  };
}

// Commit each successful header before requesting another one. A later 429
// must not discard matches that were already fetched successfully.
export async function scanHeaderPage<T>(
  ids: string[],
  read: (id: string) => Promise<T | undefined>,
  record: (candidate: T) => Promise<void>,
): Promise<boolean> {
  for (const id of ids) {
    const candidate = await read(id);
    if (candidate === undefined) return false;
    await record(candidate);
  }
  return true;
}
