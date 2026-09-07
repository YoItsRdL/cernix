/**
 * The sidebar's folder tree: where you are, and how you got there.
 *
 * The sidebar listed only the *children* of the folder on screen, so the
 * moment you reached a leaf it said "No folders" and the panel went
 * blank — at exactly the point where knowing your position matters most.
 * A photographer three levels into `2026 / September / 06` was shown
 * nothing at all about the two levels above them.
 *
 * The trail is the tree. Drive answers with parent ids and resolving
 * those to names would be a request per level for strings already on
 * screen, so the breadcrumbs the user walked are the whole source: they
 * are the ancestry, in order, and the last of them is where they are.
 * Children hang below that.
 *
 * Pure, so the shape can be tested without mounting a sidebar or a Drive.
 */

/** The two shapes this reads: a crumb and a folder both have these. */
export interface NamedFolder {
  id: string
  name: string
}

/**
 * How far the indent goes before it stops.
 *
 * Depth is the user's own Drive structure, so it has no ceiling, and the
 * sidebar is 208px wide. Measured in the running panel, the label loses
 * 12px per level: 125px at the root, 89px at four deep, 65px at six,
 * 17px at ten, and 5px at eleven — by which point the row is an indent
 * with nothing in it, and a tree you cannot read the names in has
 * stopped being a tree.
 *
 * Six is where a name is still worth reading. Past it rows keep nesting
 * in the trail and in `aria-level`, they simply stop moving right.
 */
export const MAX_INDENT_DEPTH = 6

export interface FolderTreeRow {
  id: string
  name: string
  /**
   * True nesting level; the root is 0. This is the structure, so it is
   * what `aria-level` reports: a screen reader is told where the folder
   * actually is even where the drawing has run out of room to show it.
   */
  depth: number
  /**
   * How far to indent, which is `depth` clamped to `MAX_INDENT_DEPTH`.
   * Separate from `depth` on purpose: clamping the one the assistive
   * technology reads would lie about the tree to the reader who can
   * least afford it.
   */
  indentDepth: number
  /**
   * `ancestor` is a folder you are inside; `current` is where you are;
   * `child` is a folder you could go into. They are navigated to
   * differently: an ancestor is a step back up the trail and a child is
   * a step down, and only the trail knows how far back a given ancestor
   * is.
   */
  kind: 'ancestor' | 'current' | 'child'
  /**
   * For an `ancestor`, its index in the trail, which is what
   * `navigateToBreadcrumb` takes. Absent for the other two: `current` is
   * not a link, and a `child` navigates by folder.
   */
  crumbIndex?: number
}

/**
 * Flattened to a list rather than nested, because the rendering is a
 * list of indented rows and a tree of one branch is a list wearing a
 * costume. Nesting would also need a recursive component to say what an
 * `aria-level` says in one attribute.
 */
export function folderTreeRows(
  breadcrumbs: readonly NamedFolder[],
  children: readonly NamedFolder[],
): FolderTreeRow[] {
  const rows: FolderTreeRow[] = breadcrumbs.map((crumb, i) => ({
    id: crumb.id,
    name: crumb.name,
    depth: i,
    indentDepth: Math.min(i, MAX_INDENT_DEPTH),
    kind: i === breadcrumbs.length - 1 ? 'current' : 'ancestor',
    ...(i === breadcrumbs.length - 1 ? {} : { crumbIndex: i }),
  }))

  // Children sit one level below wherever the trail ended. With no trail
  // at all — the first render, before the root has resolved — they are
  // the top level rather than being indented under nothing.
  const childDepth = breadcrumbs.length
  for (const child of children) {
    // A folder that is both in the trail and in the listing would draw
    // twice and read as two different places. The trail wins: it is the
    // one that says where you are.
    if (rows.some(r => r.id === child.id)) continue
    rows.push({
      id: child.id,
      name: child.name,
      depth: childDepth,
      indentDepth: Math.min(childDepth, MAX_INDENT_DEPTH),
      kind: 'child',
    })
  }

  return rows
}
