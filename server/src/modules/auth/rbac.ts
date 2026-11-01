export const ROLES = ["admin", "manager", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "users:manage",
  "inventory:read",
  "inventory:write",
  "workorders:read",
  "workorders:write",
  "machines:read",
  "machines:write",
  "telemetry:ingest",
  "analytics:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: [
    "inventory:read",
    "inventory:write",
    "workorders:read",
    "workorders:write",
    "machines:read",
    "machines:write",
    "analytics:read",
  ],
  operator: ["inventory:read", "workorders:read", "machines:read", "telemetry:ingest"],
  viewer: ["inventory:read", "workorders:read", "machines:read", "analytics:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
