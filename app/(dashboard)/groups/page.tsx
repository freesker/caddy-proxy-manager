import GroupsClient from "./GroupsClient";
import { listGroups } from "@/src/lib/models/groups";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";
import { listManagedGroupIds } from "@/src/lib/models/oauth-role-mappings";

export default async function GroupsPage() {
  await requireAdmin();
  const [allGroups, allUsers, managedGroupIds] = await Promise.all([
    listGroups(),
    listUsers(),
    listManagedGroupIds(),
  ]);
  const userList = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
  }));
  return <GroupsClient groups={allGroups} users={userList} managedGroupIds={managedGroupIds} />;
}
