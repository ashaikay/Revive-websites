const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function summarizeFixtureResponse(status, payload) {
  const responseType = valueType(payload);
  let keys = [];
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) keys = Object.keys(first).sort();
  } else if (payload && typeof payload === 'object') {
    keys = Object.keys(payload).sort();
  }
  return `status=${status} responseType=${responseType} responseKeys=${keys.length ? keys.join(',') : 'none'}`;
}

export function workspaceIdFromCreateResponse(response) {
  const summary = summarizeFixtureResponse(response.status, response.payload);
  if (response.status !== 200 || !Array.isArray(response.payload) || response.payload.length !== 1) {
    throw new Error(`Workspace fixture creation failed; ${summary}`);
  }
  const row = response.payload[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
    Object.keys(row).sort().join(',') !== 'created_workspace_id,created_workspace_name,created_workspace_slug' ||
    typeof row.created_workspace_id !== 'string' || !uuid.test(row.created_workspace_id) ||
    typeof row.created_workspace_name !== 'string' || typeof row.created_workspace_slug !== 'string') {
    throw new Error(`Workspace fixture response was invalid; ${summary}`);
  }
  return row.created_workspace_id;
}
