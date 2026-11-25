const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
export const EDITED_KEEP = 200

/** The file an edit call writes, from its input (forward slashes); none for any other call. */
export function editedPathOf(input: { readonly [key: string]: unknown }): string | undefined {
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
  return typeof input.tool === 'string' && EDIT_TOOLS.includes(input.tool) && typeof path === 'string' && path !== '' ? path.replace(/\\/g, '/') : undefined
}

/** `list` with `path` added once; the oldest go past `EDITED_KEEP`. */
export const recordEdited = (list: readonly string[] | undefined, path: string): string[] =>
  list?.includes(path) ? [...list] : [...(list ?? []), path].slice(-EDITED_KEEP)

/** `path` made relative to `root` (the checkout's top level), the way git lists a file; none when it lies outside. The match ignores case: Windows paths do. */
export function repoRelative(root: string | undefined, path: string): string | undefined {
  if (!root) return undefined
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return path.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? path.slice(base.length + 1) : undefined
}

/** The saved edited paths out of a parsed data file: the strings of the list, the newest `EDITED_KEEP`; none for anything else. */
export function parseEdited(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const paths = value.filter((v): v is string => typeof v === 'string' && v !== '').slice(-EDITED_KEEP)
  return paths.length > 0 ? paths : undefined
}
