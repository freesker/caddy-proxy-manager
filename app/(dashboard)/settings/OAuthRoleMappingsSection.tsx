"use client";

import { useState } from "react";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRoleMappingAction, deleteRoleMappingAction } from "./actions";

type RoleMapping = {
  id: number;
  providerId: string;
  role: string;
  groupId: number;
};

type ProviderRef = { id: string; name: string };
type GroupRef = { id: number; name: string };

interface Props {
  initialMappings: RoleMapping[];
  providers: ProviderRef[];
  groups: GroupRef[];
}

export default function OAuthRoleMappingsSection({
  initialMappings,
  providers,
  groups,
}: Props) {
  const [mappings, setMappings] = useState(initialMappings);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [role, setRole] = useState("");
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ? String(groups[0].id) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;

  async function handleAdd() {
    if (!providerId || !role.trim() || !groupId) {
      setError("Provider, role, and group are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createRoleMappingAction({
        providerId,
        role: role.trim(),
        groupId: Number(groupId),
      });
      setMappings((prev) => [...prev, created]);
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add mapping");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteRoleMappingAction(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Failed to delete mapping:", err);
    }
  }

  if (providers.length === 0) {
    return (
      <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400">
        <AlertDescription>
          Add an OAuth provider first to configure role mappings.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Map Keycloak roles to CPM groups. Membership of mapped groups is recalculated from the
        user&apos;s roles at each login (add and remove). Grant those groups access to hosts on the
        Forward Auth page.
      </p>

      {mappings.length === 0 && (
        <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400">
          <AlertDescription>No role mappings configured yet.</AlertDescription>
        </Alert>
      )}

      {mappings.map((m) => (
        <div
          key={m.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{providerName(m.providerId)}</span>
            <code className="font-mono">{m.role}</code>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{groupName(m.groupId)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive"
            onClick={() => handleDelete(m.id)}
            title="Delete mapping"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        {providers.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="h-8 text-sm w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rm-role" className="text-xs">
            Keycloak role
          </Label>
          <Input
            id="rm-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. ops"
            className="h-8 text-sm font-mono w-44"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Group</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-8 text-sm w-44">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={handleAdd} disabled={saving || groups.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Create a group first on the Groups page.
        </p>
      )}
    </div>
  );
}
