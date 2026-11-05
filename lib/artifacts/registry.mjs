/**
 * Artifact adapter registry.
 *
 * The workbench is intentionally format-agnostic at the route/shell level:
 * adapters provide deck loading, annotations and (optionally) editing.
 * P2 ships pptx (editable) and pdf (read-only + page annotations).
 */
const adapters = [];

export function registerArtifactAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !Array.isArray(adapter.extensions)) {
    throw new TypeError('artifact adapter requires id and extensions');
  }
  if (adapters.some((entry) => entry.id === adapter.id)) {
    throw new Error(`artifact adapter already registered: ${adapter.id}`);
  }
  adapters.push(adapter);
  return adapter;
}

export function adapterForPath(artifactPath) {
  const lower = String(artifactPath || '').toLowerCase();
  return adapters.find((adapter) =>
    adapter.extensions.some((extension) => lower.endsWith(String(extension).toLowerCase())),
  ) || null;
}

export function listArtifactAdapters() {
  return adapters.slice();
}
