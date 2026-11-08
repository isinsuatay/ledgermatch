import { parseRequest } from './requests.js';

const STORAGE_KEY = 'ledgermatch.workspace.v1';

export function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const entries = Array.isArray(saved?.entries) ? saved.entries : [];
    return {
      entries: entries.map((entry) => ({ ...entry, request: parseRequest(entry.request) })),
      selected: saved?.selected,
    };
  } catch {
    return { entries: [], selected: null };
  }
}

export function saveWorkspace(workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export function updateEntry(workspace, request, details = {}) {
  const entry = workspace.entries.find((item) => item.request.memo === request.memo);
  return {
    selected: request.memo,
    entries: [{ ...entry, request, ...details }, ...workspace.entries.filter((item) => item !== entry)],
  };
}
