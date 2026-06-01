import { describe, it, expect } from "vitest";
import {
  decodeJwtPayload,
  extractRoles,
  computeMembershipChanges,
  DEFAULT_ROLES_CLAIM,
} from "@/src/lib/services/oidc-role-sync";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("decodeJwtPayload", () => {
  it("decodes the payload of a JWT", () => {
    const jwt = makeJwt({ sub: "abc", realm_access: { roles: ["ops"] } });
    expect(decodeJwtPayload(jwt)).toEqual({
      sub: "abc",
      realm_access: { roles: ["ops"] },
    });
  });

  it("returns null for malformed input", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });
});

describe("extractRoles", () => {
  const claims = {
    realm_access: { roles: ["ops", "admin"] },
    resource_access: { cpm: { roles: ["viewer"] } },
    groups: ["g1", "g2"],
    flat: "not-an-array",
  };

  it("reads the default realm_access.roles path", () => {
    expect(extractRoles(claims, DEFAULT_ROLES_CLAIM)).toEqual(["ops", "admin"]);
  });

  it("reads a nested client-roles path", () => {
    expect(extractRoles(claims, "resource_access.cpm.roles")).toEqual(["viewer"]);
  });

  it("reads a flat array claim", () => {
    expect(extractRoles(claims, "groups")).toEqual(["g1", "g2"]);
  });

  it("returns undefined when the path is missing (claim absent)", () => {
    expect(extractRoles(claims, "realm_access.missing")).toBeUndefined();
    expect(extractRoles({}, DEFAULT_ROLES_CLAIM)).toBeUndefined();
  });

  it("returns undefined when the value is not an array", () => {
    expect(extractRoles(claims, "flat")).toBeUndefined();
  });

  it("returns an empty array when the claim is present but empty", () => {
    expect(extractRoles({ realm_access: { roles: [] } }, DEFAULT_ROLES_CLAIM)).toEqual([]);
  });
});

describe("computeMembershipChanges", () => {
  it("adds target managed groups the user is not in yet", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2, 3],
      targetGroupIds: [1, 2],
      currentGroupIds: [],
    });
    expect(r.toAdd.sort()).toEqual([1, 2]);
    expect(r.toRemove).toEqual([]);
  });

  it("removes managed groups the user no longer qualifies for", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2, 3],
      targetGroupIds: [1],
      currentGroupIds: [1, 2],
    });
    expect(r.toAdd).toEqual([]);
    expect(r.toRemove).toEqual([2]);
  });

  it("never touches non-managed groups", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2],
      targetGroupIds: [1],
      currentGroupIds: [1, 99], // 99 is not managed
    });
    expect(r.toAdd).toEqual([]);
    expect(r.toRemove).toEqual([]);
  });
});
