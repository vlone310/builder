/** Org roles, from most to least access. */
export const roles = ["admin", "developer", "editor", "viewer"] as const;
export type Role = (typeof roles)[number];

/**
 * What each role may change. Every member may read the org's sites, pages,
 * drafts and members; these are the writes on top.
 */
export const permissions = {
  /** Create, rename and delete pages and regions; save drafts; take locks; share previews; open the canvas. */
  "content.edit": ["admin", "developer", "editor"],
  /** Publish and unpublish. */
  "content.publish": ["admin", "developer", "editor"],
  /** Environments, API keys and webhooks of existing sites. */
  "site.configure": ["admin", "developer"],
  /** Create sites. */
  "site.create": ["admin"],
  /** Invite people, change roles, remove members. */
  "members.manage": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof permissions;

export function can(role: Role, permission: Permission): boolean {
  return (permissions[permission] as readonly Role[]).includes(role);
}
