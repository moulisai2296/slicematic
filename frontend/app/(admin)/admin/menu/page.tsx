"use client";

import { Check, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminEmptyTableRow,
  AdminError,
  AdminLoading,
  AdminPageHeader,
} from "@/components/admin/admin-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createAdminMenuCategory,
  createAdminMenuItem,
  deleteAdminMenuCategory,
  deleteAdminMenuItem,
  getAdminMenu,
  updateAdminMenuItem,
  type AdminMenuCategory,
  type AdminMenuItem,
} from "@/lib/admin-api";
import { formatINR } from "@/lib/utils";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminMenuItem[]; categories: AdminMenuCategory[] };

export default function AdminMenuPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [saving, setSaving] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminMenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeCategory, setActiveCategory] = useState("pizza");
  const [filters, setFilters] = useState({
    search: "",
    availability: "all" as "all" | "available" | "hidden",
  });
  const [draft, setDraft] = useState({
    category: "pizza",
    item_code: "",
    name: "",
    price: 0,
    is_available: true,
  });
  const [categoryDraft, setCategoryDraft] = useState({ code: "", name: "" });
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<AdminMenuCategory | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getAdminMenu();
      setState({
        status: "ready",
        items: data.menu.items,
        categories: data.menu.categories,
      });
      setActiveCategory((current) => {
        if (data.menu.categories.some((category) => category.code === current)) {
          return current;
        }
        const next = data.menu.categories.find((category) => category.code === "pizza");
        return next?.code ?? data.menu.categories[0]?.code ?? "pizza";
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Menu load failed.",
      });
    }
  }, []);

  async function save(item: AdminMenuItem) {
    setSaving(item.id);
    try {
      const res = await updateAdminMenuItem({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        is_available: item.is_available,
        image_url: item.image_url,
        reason: "Admin menu update",
      });
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              items: current.items.map((i) => (i.id === item.id ? res.item : i)),
            }
          : current
      );
    } finally {
      setSaving(null);
      setPendingDelete(null);
    }
  }

  async function createItem() {
    setCreating(true);
    try {
      await createAdminMenuItem({
        ...draft,
        price: Number(draft.price),
        reason: "Admin menu create",
      });
      setDraft({
        category: activeCategory,
        item_code: "",
        name: "",
        price: 0,
        is_available: true,
      });
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function createCategory() {
    const normalizedCode = categoryDraft.code.trim().toLowerCase().replace(/\s+/g, "_");
    await createAdminMenuCategory({
      ...categoryDraft,
      reason: "Admin menu class create",
    });
    setActiveCategory(normalizedCode);
    setDraft((current) => ({
      ...current,
      category: normalizedCode,
    }));
    setCategoryDraft({ code: "", name: "" });
    setClassModalOpen(false);
    await load();
  }

  async function deleteItem(item: AdminMenuItem) {
    setSaving(item.id);
    try {
      await deleteAdminMenuItem(item.id);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              items: current.items.filter((i) => i.id !== item.id),
            }
          : current
      );
    } finally {
      setSaving(null);
    }
  }

  async function handleCategoryDelete(categoryId: string) {
    try {
      await deleteAdminMenuCategory(categoryId);
      setActiveCategory("pizza");
      setDraft((current) => ({
        ...current,
        category: "pizza",
      }));
      await load();
    } catch (err: unknown) {
  alert(err instanceof Error ? err.message : "Failed to delete category");
}
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") return <AdminLoading label="Loading menu" />;
  if (state.status === "error") {
    return <AdminError message={state.message} onRetry={() => void load()} />;
  }

  const activeCategoryMeta =
    state.categories.find((category) => category.code === activeCategory) ??
    state.categories[0];
  const filteredItems = state.items.filter((item) => {
    const query = filters.search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.item_code.toLowerCase().includes(query) ||
      item.category_name.toLowerCase().includes(query);
    const matchesAvailability =
      filters.availability === "all" ||
      (filters.availability === "available" && item.is_available) ||
      (filters.availability === "hidden" && !item.is_available);
    return item.category === activeCategory && matchesSearch && matchesAvailability;
  });

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <AdminPageHeader
          title="Menu Management"
          subtitle="Edit menu classes, sides, beverages, dips, prices, and availability."
        />
        <Button variant="secondary" onClick={() => setClassModalOpen(true)}>
          <Plus />
          Create Menu Class
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {state.categories.map((category) => (
            <button
              key={category.code}
              className={
                category.code === activeCategory
                  ? "h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                  : "h-10 shrink-0 rounded-lg border border-border bg-surface-2 px-4 text-sm font-medium"
              }
              onClick={() => {
                setActiveCategory(category.code);
                setDraft((current) => ({ ...current, category: category.code }));
              }}
            >
              {category.name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold">Create Menu Item</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[160px_130px_1fr_120px_auto_auto]">
          <select
            className="h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm"
            value={draft.category}
            onChange={(event) =>
              setDraft({
                ...draft,
                category: event.target.value,
              })
            }
          >
            {state.categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
          <Input
            placeholder="Code"
            value={draft.item_code}
            onChange={(event) => setDraft({ ...draft, item_code: event.target.value })}
          />
          <Input
            placeholder="Name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Input
            type="number"
            min={0}
            value={draft.price}
            onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })}
          />
          <button
            className="flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
            onClick={() => setDraft({ ...draft, is_available: !draft.is_available })}
          >
            {draft.is_available ? <Check className="size-4" /> : <X className="size-4" />}
            <Badge variant={draft.is_available ? "success" : "destructive"}>
              {draft.is_available ? "Available" : "Hidden"}
            </Badge>
          </button>
          <Button
            disabled={!draft.item_code || !draft.name || creating}
            onClick={() => void createItem()}
          >
            <Plus />
            Add
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_170px]">
          <Input
            placeholder={`Search ${activeCategoryMeta?.name ?? "menu items"}`}
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
          <select
            className="h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm"
            value={filters.availability}
            onChange={(event) =>
              setFilters({
                ...filters,
                availability: event.target.value as typeof filters.availability,
              })
            }
          >
            <option value="all">All availability</option>
            <option value="available">Available only</option>
            <option value="hidden">Hidden only</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-start gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-heading text-lg font-semibold">
                  {activeCategoryMeta?.name ?? "Menu Items"}
                </h2>
                {!["base", "pizza", "topping", "side"].includes(activeCategoryMeta?.code ?? "") && activeCategoryMeta && (
                  <Button
                    variant="destructive"
                    className="h-7 px-2 text-xs font-semibold"
                    onClick={() => {
                      setPendingCategoryDelete(activeCategoryMeta);
                    }}
                  >
                    <Trash2 className="size-3 mr-1" />
                    Remove Class
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Horizontal classes show one section at a time.
              </p>
            </div>
          </div>
          <Badge>{filteredItems.length}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Photo</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    saving={saving === item.id}
                    onChange={(next) =>
                      setState((current) =>
                        current.status === "ready"
                          ? {
                              ...current,
                              items: current.items.map((i) =>
                                i.id === next.id ? next : i
                              ),
                            }
                          : current
                      )
                    }
                    onSave={save}
                    onDelete={setPendingDelete}
                  />
                ))
              ) : (
                <AdminEmptyTableRow
                  colSpan={6}
                  title="No menu items match"
                  description="Adjust search or availability filters to see more menu items."
                />
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AdminConfirmDialog
        open={Boolean(pendingDelete)}
        title="Soft delete menu item?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be removed from active admin menus and cannot be ordered until restored from data tools.`
            : ""
        }
        confirmLabel="Soft delete"
        busy={Boolean(pendingDelete && saving === pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteItem(pendingDelete);
        }}
      />

      <AdminConfirmDialog
        open={Boolean(pendingCategoryDelete)}
        title={`Delete "${pendingCategoryDelete?.name ?? ""}" class?`}
        description={`This will permanently remove the "${pendingCategoryDelete?.name ?? ""}" class and all menu items inside it. This action cannot be undone.`}
        confirmLabel="Delete class"
        onCancel={() => setPendingCategoryDelete(null)}
        onConfirm={() => {
          if (pendingCategoryDelete) {
            void handleCategoryDelete(pendingCategoryDelete.id);
            setPendingCategoryDelete(null);
          }
        }}
      />

      {classModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 px-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-semibold">Create Menu Class</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add classes like Sides, Beverages, Dips, Desserts, or Combos.
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label="Close menu class modal"
                onClick={() => setClassModalOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="mt-5 grid gap-3">
              <label className="space-y-2">
                <span className="text-sm font-medium">Class code</span>
                <Input
                  placeholder="sides"
                  value={categoryDraft.code}
                  onChange={(event) =>
                    setCategoryDraft({ ...categoryDraft, code: event.target.value })
                  }
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Class name</span>
                <Input
                  placeholder="Sides"
                  value={categoryDraft.name}
                  onChange={(event) =>
                    setCategoryDraft({ ...categoryDraft, name: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setClassModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!categoryDraft.code || !categoryDraft.name}
                onClick={() => void createCategory()}
              >
                <Plus />
                Add Class
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

import { uploadAdminMenuItemPhoto } from "@/lib/admin-api";
import { Upload } from "lucide-react";
import Image from "next/image";

function MenuRow({
  item,
  saving,
  onChange,
  onSave,
  onDelete,
}: {
  item: AdminMenuItem;
  saving: boolean;
  onChange: (item: AdminMenuItem) => void;
  onSave: (item: AdminMenuItem) => Promise<void>;
  onDelete: (item: AdminMenuItem) => void;
}) {
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3 font-medium">{item.item_code}</td>
      <td className="px-4 py-3">
        <Input
          value={item.name}
          onChange={(event) => onChange({ ...item, name: event.target.value })}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {item.image_url ? (
            <Image
              src={item.image_url}
              alt={item.name}
              width={80}
              height={80}
              className="rounded-md object-cover size-20"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-md bg-surface-2 text-xs text-muted-foreground">
              None
            </div>
          )}
          <label className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-2 text-xs font-medium hover:bg-surface-2">
            <Upload className="mr-1 size-3" />
            Upload
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const res = await uploadAdminMenuItemPhoto(item.id, file);
                  if (res.ok) {
                    onChange({ ...item, image_url: res.image_url });
                    await onSave({ ...item, image_url: res.image_url });
                  }
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Upload failed");
                }
              }}
            />
          </label>
        </div>
      </td>
      <td className="px-4 py-3">
        <Input
          type="number"
          min={0}
          value={item.price}
          onChange={(event) =>
            onChange({ ...item, price: Number(event.target.value) })
          }
        />
        <p className="mt-1 text-xs text-muted-foreground">{formatINR(item.price)}</p>
      </td>
      <td className="px-4 py-3">
        <button
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          onClick={() => onChange({ ...item, is_available: !item.is_available })}
        >
          {item.is_available ? <Check className="size-4" /> : <X className="size-4" />}
          <Badge variant={item.is_available ? "success" : "destructive"}>
            {item.is_available ? "Available" : "Unavailable"}
          </Badge>
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => void onSave(item)}
          >
            <Save />
            Save
          </Button>
          <Button
            size="icon-sm"
            variant="destructive"
            disabled={saving}
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item)}
          >
            <Trash2 />
          </Button>
        </div>
      </td>
    </tr>
  );
}
