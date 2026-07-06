"use client";

import { Save, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import {
  createAdminStaff,
  getAdminStaff,
  updateAdminStaff,
  type AdminRole,
  type AdminStaffMember,
} from "@/lib/admin-api";
import {
  AdminEmptyTableRow,
  AdminError,
  AdminLoading,
  AdminPageHeader,
} from "@/components/admin/admin-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; staff: AdminStaffMember[]; roles: AdminRole[] };

const emptyStaff = {
  full_name: "",
  email: "",
  phone: "",
  role_name: "Customer Facing Staff",
  employee_code: "",
  pin: "",
};

export default function AdminStaffPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [draft, setDraft] = useState(emptyStaff);
  const [saving, setSaving] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    role: "all",
    status: "all" as "all" | "active" | "inactive",
  });

  async function load() {
    setState({ status: "loading" });
    try {
      const data = await getAdminStaff();
      setState({ status: "ready", staff: data.staff, roles: data.roles });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Staff load failed.",
      });
    }
  }

  async function create() {
    setSaving("new");
    try {
      await createAdminStaff({ ...draft, reason: "Admin staff create" });
      setDraft(emptyStaff);
      await load();
    } finally {
      setSaving(null);
    }
  }

  async function save(member: AdminStaffMember) {
    setSaving(member.id);
    try {
      await updateAdminStaff(member.id, {
        full_name: member.full_name,
        phone: member.phone,
        role_name: member.role_name,
        is_active: member.is_active,
        reason: "Admin staff update",
      });
      await load();
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (state.status === "loading") return <AdminLoading label="Loading staff" />;
  if (state.status === "error") {
    return <AdminError message={state.message} onRetry={() => void load()} />;
  }

  const filteredStaff = state.staff.filter((member) => {
    const query = filters.search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      member.full_name.toLowerCase().includes(query) ||
      member.email.toLowerCase().includes(query) ||
      (member.phone ?? "").toLowerCase().includes(query) ||
      member.employee_code.toLowerCase().includes(query);
    const matchesRole = filters.role === "all" || member.role_name === filters.role;
    const matchesStatus =
      filters.status === "all" ||
      (filters.status === "active" && member.is_active) ||
      (filters.status === "inactive" && !member.is_active);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <AdminPageHeader
        title="Staff Management"
        subtitle="Create staff users, assign roles, and activate or deactivate accounts."
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="size-5 text-primary" />
          <h2 className="font-heading text-lg font-semibold">Create Staff</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_160px_100px_110px_auto]">
          <Input
            placeholder="Full name"
            value={draft.full_name}
            onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
          />
          <Input
            placeholder="Email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          <Input
            placeholder="Phone"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
          <RoleSelect
            roles={state.roles}
            value={draft.role_name}
            onChange={(role_name) => setDraft({ ...draft, role_name })}
          />
          <Input
            placeholder="Code"
            value={draft.employee_code}
            onChange={(event) =>
              setDraft({ ...draft, employee_code: event.target.value })
            }
          />
          <Input
            placeholder="PIN"
            type="password"
            maxLength={6}
            value={draft.pin}
            onChange={(event) => setDraft({ ...draft, pin: event.target.value })}
          />
          <Button disabled={saving === "new"} onClick={() => void create()}>
            <UserPlus />
            Create
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_160px]">
          <Input
            placeholder="Search staff name, email, phone, or code"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
          <select
            className="h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm"
            value={filters.role}
            onChange={(event) => setFilters({ ...filters, role: event.target.value })}
          >
            <option value="all">All roles</option>
            {state.roles.map((role) => (
              <option key={role.id} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm"
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as typeof filters.status })
            }
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Staff Directory</h2>
            <p className="text-xs text-muted-foreground">
              Showing {filteredStaff.length} of {state.staff.length}
            </p>
          </div>
          <Badge>{filteredStaff.length}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.length ? (
                filteredStaff.map((member) => (
                  <StaffRow
                    key={member.id}
                    member={member}
                    roles={state.roles}
                    saving={saving === member.id}
                    onChange={(next) =>
                      setState((current) =>
                        current.status === "ready"
                          ? {
                              ...current,
                              staff: current.staff.map((m) =>
                                m.id === next.id ? next : m
                              ),
                            }
                          : current
                      )
                    }
                    onSave={save}
                  />
                ))
              ) : (
                <AdminEmptyTableRow
                  colSpan={5}
                  title="No staff members match"
                  description="Adjust search or filters to see more staff members."
                />
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function StaffRow({
  member,
  roles,
  saving,
  onChange,
  onSave,
}: {
  member: AdminStaffMember;
  roles: AdminRole[];
  saving: boolean;
  onChange: (member: AdminStaffMember) => void;
  onSave: (member: AdminStaffMember) => Promise<void>;
}) {
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3">
        <Input
          value={member.full_name}
          onChange={(event) => onChange({ ...member, full_name: event.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">{member.employee_code}</p>
      </td>
      <td className="px-4 py-3">
        <RoleSelect
          roles={roles}
          value={member.role_name}
          onChange={(role_name) => onChange({ ...member, role_name })}
        />
      </td>
      <td className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{member.email}</p>
        <Input
          className="mt-2"
          value={member.phone ?? ""}
          onChange={(event) => onChange({ ...member, phone: event.target.value })}
        />
      </td>
      <td className="px-4 py-3">
        <button
          className="rounded-lg border border-border px-3 py-2"
          onClick={() => onChange({ ...member, is_active: !member.is_active })}
        >
          <Badge variant={member.is_active ? "success" : "destructive"}>
            {member.is_active ? "Active" : "Inactive"}
          </Badge>
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="secondary"
          size="sm"
          disabled={saving}
          onClick={() => void onSave(member)}
        >
          <Save />
          Save
        </Button>
      </td>
    </tr>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
}: {
  roles: AdminRole[];
  value: string;
  onChange: (role: string) => void;
}) {
  return (
    <select
      className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {roles.map((role) => (
        <option key={role.id} value={role.name}>
          {role.name}
        </option>
      ))}
    </select>
  );
}
