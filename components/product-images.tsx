"use client";

import { useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import {
  ImageIcon,
  UploadSimpleIcon,
  LinkSimpleIcon,
  TrashIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";

export const MAX_PRODUCT_IMAGES = 8;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * One image while it is being edited.
 *
 * A freshly chosen file is held in memory and only uploaded when the product is
 * saved — uploading on selection would leave a file in storage every time
 * somebody opens the dialog, adds a picture and then cancels.
 */
export type ImageDraft = {
  /** Set for an image already stored against the product. */
  storageId?: Id<"_storage">;
  /** Set for an image hosted somewhere else. */
  externalUrl?: string;
  alt: string;
  /** Chosen in this session and not yet uploaded. */
  file?: File;
  /** What to render right now: an object URL, or the resolved remote one. */
  preview: string;
};

/** Builds the editor's state from what the server returned for a product. */
export function draftsFromProduct(
  images: Array<{ storageId?: Id<"_storage">; externalUrl?: string; alt?: string }>,
  resolved: Array<{ url: string; alt: string | null }>
): ImageDraft[] {
  // `resolvedImages` drops entries whose file has gone missing, so the two
  // lists are matched by position over whichever is shorter rather than
  // zipped blindly.
  return images.slice(0, resolved.length).map((image, index) => ({
    storageId: image.storageId,
    externalUrl: image.externalUrl,
    alt: image.alt ?? "",
    preview: resolved[index].url,
  }));
}

/**
 * Uploads anything still held as a File and returns the list in the shape the
 * `products` mutations take. Call it once, on save.
 */
export async function uploadDrafts(
  drafts: ImageDraft[],
  getUploadUrl: () => Promise<string>
): Promise<
  Array<{
    storageId?: Id<"_storage">;
    externalUrl?: string;
    alt?: string;
  }>
> {
  const out = [];
  for (const draft of drafts) {
    const alt = draft.alt.trim() || undefined;

    if (draft.storageId) {
      out.push({ storageId: draft.storageId, alt });
      continue;
    }
    if (!draft.file) {
      out.push({ externalUrl: draft.externalUrl, alt });
      continue;
    }

    const uploadUrl = await getUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": draft.file.type || "application/octet-stream" },
      body: draft.file,
    });
    if (!response.ok) {
      throw new Error(
        `Could not upload ${draft.file.name} (HTTP ${response.status})`
      );
    }
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    out.push({ storageId, alt });
  }
  return out;
}

export function ProductImagesEditor({
  value,
  onChange,
}: {
  value: ImageDraft[];
  onChange: (next: ImageDraft[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");

  const room = MAX_PRODUCT_IMAGES - value.length;

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: ImageDraft[] = [];

    for (const file of Array.from(files)) {
      if (accepted.length >= room) break;
      if (!file.type.startsWith("image/")) {
        toast.add({
          title: `${file.name} is not an image`,
          type: "error",
        });
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.add({
          title: `${file.name} is too large`,
          description: `Images must be under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB. Resize it and try again.`,
          type: "error",
        });
        continue;
      }
      accepted.push({
        alt: "",
        file,
        preview: URL.createObjectURL(file),
      });
    }

    if (accepted.length) onChange([...value, ...accepted]);
    if (files.length > room) {
      toast.add({
        title: `Only ${MAX_PRODUCT_IMAGES} images per product`,
        description: "Remove one to add another.",
        type: "warning",
      });
    }
    // Cleared so choosing the same file again still fires a change event.
    if (fileRef.current) fileRef.current.value = "";
  };

  const addUrl = () => {
    const candidate = url.trim();
    if (!candidate) return;
    if (!/^https?:\/\/\S+$/i.test(candidate)) {
      toast.add({
        title: "That is not an image address",
        description: "It needs to start with http:// or https://",
        type: "error",
      });
      return;
    }
    if (room <= 0) {
      toast.add({
        title: `Only ${MAX_PRODUCT_IMAGES} images per product`,
        type: "warning",
      });
      return;
    }
    onChange([
      ...value,
      { alt: "", externalUrl: candidate, preview: candidate },
    ]);
    setUrl("");
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const removeAt = (index: number) => {
    const draft = value[index];
    // Only object URLs are ours to revoke; a remote address must survive.
    if (draft.file) URL.revokeObjectURL(draft.preview);
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Images</Label>
          <p className="text-xs text-muted-foreground">
            The first one is the catalogue thumbnail, and the one an agent offers
            when a customer asks what it looks like.
          </p>
        </div>
        {value.length > 0 ? (
          <Badge variant="secondary">
            {value.length} of {MAX_PRODUCT_IMAGES}
          </Badge>
        ) : null}
      </div>

      {value.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed p-5 text-center">
          <ImageIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No images yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((draft, index) => (
            <div
              key={`${draft.storageId ?? draft.externalUrl ?? draft.preview}-${index}`}
              className="flex flex-col gap-1.5 rounded-md border p-2"
            >
              <div className="relative overflow-hidden rounded bg-muted">
                {/* A plain <img>: these come from Convex storage and from
                    whatever host a company keeps its product shots on, so
                    next/image would need every one of those domains
                    pre-declared in next.config. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.preview}
                  alt={draft.alt || "Product image"}
                  className="aspect-square w-full object-cover"
                />
                {index === 0 ? (
                  <Badge className="absolute top-1 left-1">Main</Badge>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-1">
                <div className="flex gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move image earlier"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowLeftIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move image later"
                    disabled={index === value.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowRightIcon />
                  </Button>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove image"
                  onClick={() => removeAt(index)}
                >
                  <TrashIcon />
                </Button>
              </div>

              <Input
                value={draft.alt}
                placeholder="Describe it"
                aria-label={`Description for image ${index + 1}`}
                className="h-8 text-xs"
                onChange={(event) => {
                  const next = [...value];
                  next[index] = { ...next[index], alt: event.target.value };
                  onChange(next);
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <Button
          variant="outline"
          disabled={room <= 0}
          onClick={() => fileRef.current?.click()}
        >
          <UploadSimpleIcon /> Upload
        </Button>
        <div className="flex min-w-52 flex-1 gap-1">
          <Input
            value={url}
            placeholder="…or paste an image URL"
            disabled={room <= 0}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addUrl();
              }
            }}
          />
          <Button
            variant="outline"
            aria-label="Add image URL"
            disabled={room <= 0 || !url.trim()}
            onClick={addUrl}
          >
            <LinkSimpleIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The catalogue thumbnail, or a placeholder when a product has no picture. */
export function ProductThumbnail({
  url,
  alt,
  className,
}: {
  url?: string;
  alt?: string;
  className?: string;
}) {
  if (!url) {
    return (
      <div
        className={
          "flex size-10 shrink-0 items-center justify-center rounded border bg-muted text-muted-foreground " +
          (className ?? "")
        }
        aria-hidden="true"
      >
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? ""}
      loading="lazy"
      className={
        "size-10 shrink-0 rounded border object-cover " + (className ?? "")
      }
    />
  );
}
