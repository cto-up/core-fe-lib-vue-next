/**
 * Update user store from Kratos session (Vue/Pinia specific)
 */

import { type KratosSession } from "../core/kratos-service";
import { useUserStore } from "core-fe-lib/stores/user-store";
import type { LoggedUser } from "core-fe-lib/models/logged-user";
import { Role } from "core-fe-lib/openapi/core/models/Role";

export async function updateUserFromSession(
  kratosSession: KratosSession | null
) {
  const userStore = useUserStore();

  if (!kratosSession) {
    userStore.setUser(null);
    userStore.setSession(null);
    return;
  }

  userStore.setSession(kratosSession);

  const globalRoles =
    kratosSession.identity.metadata_public?.global_roles || [];

  const tenantMemberships =
    kratosSession.identity.metadata_public?.tenant_memberships || [];

  const { useTenantStore } = await import("core-fe-lib/stores/tenant-store");
  const tenantStore = useTenantStore();
  const currentTenantId = tenantStore.tenant?.tenant_id;

  let tenantRoles: string[] = [];
  if (currentTenantId && tenantMemberships.length > 0) {
    const currentTenantMembership = tenantMemberships.find(
      (membership: { tenant_id: string; roles: string[] }) =>
        membership.tenant_id === currentTenantId
    );
    tenantRoles = currentTenantMembership?.roles || [];
  } else if (!currentTenantId && tenantMemberships.length > 0) {
    console.log("ℹ️  Tenant not loaded yet, using global roles only");
  }

  const roles = [...new Set([...globalRoles, ...tenantRoles])];

  const user: LoggedUser = {
    id: kratosSession.identity.id,
    uid: kratosSession.identity.id,
    email: kratosSession.identity.traits.email,
    name: kratosSession.identity.traits.name || "",
    roles: roles,
  } as LoggedUser;

  if (globalRoles.length === 0 && tenantRoles.length === 0) {
    console.warn("⚠️  No roles found. User may not have proper permissions.");
  }

  // Set user immediately so name/roles are available before profile fetch
  userStore.setUser(user);

  // Fetch is_reseller from profile endpoint (derived from auth claims server-side)
  try {
    const { DefaultService } = await import("core-fe-lib/openapi/core");
    const profile = await DefaultService.getMeProfile();
    const isActingReseller = profile.is_acting_reseller ?? false;
    // A reseller's CUSTOMER_ADMIN holds no membership — and so no role — in the
    // customer tenants it manages, yet it is a customer admin of every one of
    // them. Fold that into roles here (the backend grants the same role from the
    // same condition) so every downstream check agrees: isCustomerAdmin,
    // hasPrivilege, hasRole and the router's "has any role" guard.
    userStore.setUser({
      ...userStore.user!,
      name: profile.name || user.name,
      roles: isActingReseller
        ? [...new Set([...roles, Role.CUSTOMER_ADMIN])]
        : roles,
      isReseller: profile.is_reseller ?? false,
      isActingReseller,
    });
  } catch {
    userStore.setUser({
      ...userStore.user!,
      isReseller: false,
      isActingReseller: false,
    });
  }
}
