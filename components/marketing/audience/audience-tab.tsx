"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ExportContactsButton } from "@/components/marketing/export-contacts-button";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  BellSlashIcon,
  BroomIcon,
  GearSixIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  TagIcon,
  TrashIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { PersonDialog, type Person } from "./person-dialog";
import { AudienceSettingsDialog } from "./settings-dialog";
import { categoryLabel, categoryTone, fail, formatPhone, plural, type Category } from "./shared";

type View =
  | { kind: "all" }
  | { kind: "category"; key: string }
  | { kind: "audience"; id: Id<"audiences">; name: string }
  | { kind: "unsubscribed" };

const IMPORT_STATUS: Record<string, string> = {
  uploading: "Uploading",
  sorting: "Sorting",
  review: "Waiting for review",
  saving: "Saving",
  saved: "Saved",
};


export function AudienceTab({
  categories,
  weeklyCap,
  reachable,
  optedOut,
  onAddByHand,
  birthdays,
}: {
  categories: Category[];
  weeklyCap: number;
  reachable: number;
  optedOut: number;
  onAddByHand: () => void;
  birthdays: ReactNode;
}) {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<Id<"contacts">>>(new Set());
  const [person, setPerson] = useState<Person | null>(null);
  const importBase = `/w/${workspace.slug}/marketing/audience/import`;
  const [settingsOpen, setSettingsOpen] = useState(0);

  const audiences = useQuery(api.audience.list, { workspaceId: workspace._id });
  const imports = useQuery(api.audienceImports.list, { workspaceId: workspace._id });
  const summary = useQuery(api.audience.tags, { workspaceId: workspace._id });
  const people = usePaginatedQuery(
    api.audience.people,
    {
      workspaceId: workspace._id,
      search: search.trim() || undefined,
      tag: tag || undefined,
      ...(view.kind === "category" ? { category: view.key } : {}),
      ...(view.kind === "audience" ? { audienceId: view.id } : {}),
      ...(view.kind === "unsubscribed" ? { subscription: "unsubscribed" as const } : {}),
    },
    { initialNumItems: 50 }
  );

  const updatePeople = useMutation(api.audience.updatePeople);
  const createAudience = useMutation(api.audience.create);
  const addPeople = useMutation(api.audience.addPeople);
  const removePeople = useMutation(api.audience.removePeople);
  const removeAudience = useMutation(api.audience.remove);

  const choose = (next: View) => {
    setView(next);
    setSelected(new Set());
  };
  const ids = [...selected];
  const bulk = async (task: () => Promise<unknown>, done: string) => {
    try {
      await task();
      toast.add({ title: done, type: "success" });
      setSelected(new Set());
    } catch (error) {
      fail("Could not do that", error);
    }
  };

  const pending = (imports ?? []).filter((row) => row.status !== "saved");
  const rows = people.results;
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row._id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Audience</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Everyone your campaigns and events can reach. Import contacts from a CSV and they are
            cleaned up and checked by Jev, then reviewed by you before anyone is added.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="icon" aria-label="Audience settings" onClick={() => setSettingsOpen((n) => n + 1)}>
            <GearSixIcon />
          </Button>
          <ExportContactsButton />
          <Button variant="outline" onClick={onAddByHand}>
            <UserPlusIcon /> Add by hand
          </Button>
          <Button nativeButton={false} render={<Link href={importBase} />}>
            <BroomIcon /> Import contacts
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Can be messaged" value={reachable} />
        <Tile label="Unsubscribed" value={optedOut} />
        <Tile label="Lists" value={audiences?.length ?? 0} />
        <Tile label="Sorted into a category" value={sortedCount(summary?.categories)} />
      </div>

      {pending.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Imports</p>
          {pending.map((row) => (
            <Link
              key={row._id}
              href={`${importBase}/${row._id}`}
              className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
            >
              {row.status === "sorting" || row.status === "saving" ? <Spinner /> : <BroomIcon className="size-4 text-primary" />}
              <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
              <span className="text-xs text-muted-foreground">{plural(row.total, "row")}</span>
              <Badge variant={row.status === "review" ? "default" : "outline"}>
                {IMPORT_STATUS[row.status] ?? row.status}
              </Badge>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-3">
          <RailGroup title="Everyone">
            <RailItem active={view.kind === "all"} onClick={() => choose({ kind: "all" })} icon={<UsersThreeIcon />}>
              All contacts
            </RailItem>
            <RailItem
              active={view.kind === "unsubscribed"}
              onClick={() => choose({ kind: "unsubscribed" })}
              icon={<BellSlashIcon />}
              count={optedOut}
            >
              Unsubscribed
            </RailItem>
          </RailGroup>
          <RailGroup title="Categories">
            {categories.map((category) => (
              <RailItem
                key={category.key}
                active={view.kind === "category" && view.key === category.key}
                onClick={() => choose({ kind: "category", key: category.key })}
                icon={<span className={`size-2.5 rounded-full ${categoryTone(categories, category.key).split(" ")[0]}`} />}
                count={summary?.categories[category.key]}
              >
                {category.label}
              </RailItem>
            ))}
          </RailGroup>
          <RailGroup title="Lists">
            {audiences === undefined ? (
              <Spinner />
            ) : audiences.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Lists come from imports, or pick people and save them as one.
              </p>
            ) : (
              audiences.map((audience) => (
                <RailItem
                  key={audience._id}
                  active={view.kind === "audience" && view.id === audience._id}
                  onClick={() => choose({ kind: "audience", id: audience._id, name: audience.name })}
                  icon={<ListBulletsIcon />}
                  count={audience.memberCount}
                >
                  {audience.name}
                </RailItem>
              ))
            )}
          </RailGroup>
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-72">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                placeholder="Search name, number, company"
                className="pl-8"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <SelectField
              aria-label="Tag"
              className="w-44"
              value={tag}
              placeholder="Any tag"
              onValueChange={setTag}
              options={[
                { value: "", label: "Any tag" },
                ...(summary?.tags ?? []).map((row) => ({ value: row.tag, label: `${row.tag} (${row.count})` })),
              ]}
            />
            {view.kind === "audience" ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                onClick={() => {
                  if (!confirm(`Delete the list “${view.name}”? The contacts stay.`)) return;
                  void bulk(() => removeAudience({ audienceId: view.id }), "List deleted").then(() =>
                    choose({ kind: "all" })
                  );
                }}
              >
                <TrashIcon /> Delete list
              </Button>
            ) : null}
          </div>

          {selected.size > 0 ? (
            <BulkBar
              count={selected.size}
              categories={categories}
              inList={view.kind === "audience"}
              onCategory={(category) =>
                void bulk(
                  () => updatePeople({ workspaceId: workspace._id, contactIds: ids, category }),
                  `Moved ${plural(ids.length, "contact")}`
                )
              }
              onTag={(value) =>
                void bulk(
                  () => updatePeople({ workspaceId: workspace._id, contactIds: ids, addTags: [value] }),
                  `Tagged ${plural(ids.length, "contact")}`
                )
              }
              onNewList={(name) =>
                void bulk(
                  () => createAudience({ workspaceId: workspace._id, name, contactIds: ids }),
                  `List “${name}” created`
                )
              }
              onAddToList={(audienceId) =>
                void bulk(() => addPeople({ audienceId, contactIds: ids }), "Added to the list")
              }
              onRemoveFromList={
                view.kind === "audience"
                  ? () => void bulk(() => removePeople({ audienceId: view.id, contactIds: ids }), "Removed from the list")
                  : undefined
              }
              audiences={(audiences ?? []).map((a) => ({ value: a._id, label: a.name }))}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          {people.status === "LoadingFirstPage" ? (
            <TableSkeleton rows={6} columns={4} />
          ) : rows.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersThreeIcon />
                </EmptyMedia>
                <EmptyTitle>{search || tag ? "Nobody matches" : "Nobody here yet"}</EmptyTitle>
                <EmptyDescription>
                  {search || tag
                    ? "Try another search or tag."
                    : "Bring in a list, or wait for people to message you on WhatsApp."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        aria-label="Select all"
                        checked={allChecked}
                        onCheckedChange={(next) =>
                          setSelected(next ? new Set(rows.map((row) => row._id)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="hidden md:table-cell">Tags</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id} className="cursor-pointer" onClick={() => setPerson(row)}>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${row.name ?? row.phone}`}
                          checked={selected.has(row._id)}
                          onCheckedChange={(next) => {
                            const copy = new Set(selected);
                            if (next) copy.add(row._id);
                            else copy.delete(row._id);
                            setSelected(copy);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{row.name ?? "No name"}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {formatPhone(row.phone)}
                          {row.company ? ` · ${row.company}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${categoryTone(categories, row.category)}`}>
                          {categoryLabel(categories, row.category)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {row.tags.slice(0, 4).map((value) => (
                            <Badge key={value} variant="outline" className="text-[10px]">
                              {value}
                            </Badge>
                          ))}
                          {row.tags.length > 4 ? (
                            <span className="text-xs text-muted-foreground">+{row.tags.length - 4}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {row.optedOutAt ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Unsubscribed
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Subscribed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {people.status === "CanLoadMore" || people.status === "LoadingMore" ? (
                <div className="flex justify-center border-t border-border p-2">
                  <Button size="sm" variant="ghost" disabled={people.status === "LoadingMore"} onClick={() => people.loadMore(50)}>
                    {people.status === "LoadingMore" ? <Spinner /> : null} Show more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {birthdays}

      {person ? (
        <PersonDialog key={person._id} person={person} categories={categories} onClose={() => setPerson(null)} />
      ) : null}
      {settingsOpen ? (
        <AudienceSettingsDialog
          key={settingsOpen}
          open
          categories={categories}
          weeklyCap={weeklyCap}
          onClose={() => setSettingsOpen(0)}
        />
      ) : null}
    </div>
  );
}

function sortedCount(categories: Record<string, number> | undefined) {
  if (!categories) return 0;
  return Object.entries(categories)
    .filter(([key]) => key && key !== "unknown")
    .reduce((sum, [, count]) => sum + count, 0);
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function RailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function RailItem({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors [&_svg]:size-4 ${
        active ? "bg-muted font-medium" : "hover:bg-muted/50"
      }`}
    >
      <span className="flex size-4 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
      ) : null}
    </button>
  );
}

function BulkBar({
  count,
  categories,
  audiences,
  inList,
  onCategory,
  onTag,
  onNewList,
  onAddToList,
  onRemoveFromList,
  onClear,
}: {
  count: number;
  categories: Category[];
  audiences: Array<{ value: string; label: string }>;
  inList: boolean;
  onCategory: (category: string) => void;
  onTag: (tag: string) => void;
  onNewList: (name: string) => void;
  onAddToList: (audienceId: Id<"audiences">) => void;
  onRemoveFromList?: () => void;
  onClear: () => void;
}) {
  const [tag, setTag] = useState("");
  const [listName, setListName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
      <span className="px-1 font-medium">{plural(count, "selected", "selected")}</span>
      <SelectField
        size="sm"
        aria-label="Move to category"
        className="w-40"
        value=""
        placeholder="Move to…"
        onValueChange={onCategory}
        options={categories.map((c) => ({ value: c.key, label: c.label }))}
      />
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (tag.trim()) onTag(tag.trim());
          setTag("");
        }}
      >
        <Input value={tag} placeholder="Add a tag" className="h-7 w-32" onChange={(e) => setTag(e.target.value)} />
        <Button size="sm" type="submit" variant="outline" disabled={!tag.trim()}>
          <TagIcon /> Tag
        </Button>
      </form>
      {audiences.length > 0 && !inList ? (
        <SelectField
          size="sm"
          aria-label="Add to list"
          className="w-40"
          value=""
          placeholder="Add to list…"
          onValueChange={(value) => onAddToList(value as Id<"audiences">)}
          options={audiences}
        />
      ) : null}
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (listName.trim()) onNewList(listName.trim());
          setListName("");
        }}
      >
        <Input
          value={listName}
          placeholder="New list name"
          className="h-7 w-36"
          onChange={(e) => setListName(e.target.value)}
        />
        <Button size="sm" type="submit" variant="outline" disabled={!listName.trim()}>
          <ListBulletsIcon /> Save as list
        </Button>
      </form>
      {onRemoveFromList ? (
        <Button size="sm" variant="ghost" onClick={onRemoveFromList}>
          Remove from list
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
