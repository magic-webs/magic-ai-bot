"use client";

/* eslint-disable @next/next/no-img-element -- the chat preview draws the logo
   the way the widget does, from whatever host it lives on. */
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { CompanyLogo } from "@/components/company-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { LinkIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";
import { putFile } from "@/lib/upload";

/** Larger than any logo needs to be; a 10 MB PNG is a photo, not a mark. */
const MAX_BYTES = 2 * 1024 * 1024;

function fail(title: string, error: unknown) {
  toast.add({
    title,
    description: friendlyError(error),
    type: "error",
  });
}

/**
 * The company logo: upload it, link it, see where it shows.
 *
 * Saved the moment it is chosen rather than with the profile's Save button —
 * an upload is already a round trip to storage, and a file that uploaded but
 * was never attached would sit in storage with nothing pointing at it.
 *
 * The previews are the point of the card. A logo that looks fine on its own
 * can vanish on the chat header's colour or turn to a smudge at 32px, and the
 * place to find that out is here rather than on the customer's website.
 */
export function CompanyLogoCard() {
  const workspace = useWorkspace();
  const generateUploadUrl = useMutation(api.workspaces.generateLogoUploadUrl);
  const setLogo = useMutation(api.workspaces.setLogo);
  const clearLogo = useMutation(api.workspaces.clearLogo);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "link" | "remove" | null>(null);
  const [link, setLink] = useState("");

  const current = workspace.logoSrc;

  const upload = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.add({ title: "That is not an image", type: "error" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.add({
        title: "That file is too large",
        description: "Keep the logo under 2 MB — a PNG or SVG of the mark is plenty.",
        type: "error",
      });
      return;
    }

    setBusy("upload");
    try {
      const key = await putFile(
        await generateUploadUrl({ workspaceId: workspace._id }),
        file
      );
      await setLogo({ workspaceId: workspace._id, key });
      toast.add({ title: "Logo updated", type: "success" });
    } catch (error) {
      fail("Could not upload the logo", error);
    } finally {
      setBusy(null);
    }
  };

  const applyLink = async () => {
    if (!link.trim()) return;
    setBusy("link");
    try {
      await setLogo({ workspaceId: workspace._id, url: link.trim() });
      setLink("");
      toast.add({ title: "Logo updated", type: "success" });
    } catch (error) {
      fail("Could not use that link", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await clearLogo({ workspaceId: workspace._id });
      toast.add({ title: "Logo removed", type: "success" });
    } catch (error) {
      fail("Could not remove the logo", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Shown in your sidebar and at the top of the chat on your website.
          Saved as soon as you pick it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ---------------------------------------------------- controls */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-4">
            <CompanyLogo
              src={current}
              className="size-20 rounded-xl"
              alt={`${workspace.name} logo`}
            />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                className="hidden"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => fileRef.current?.click()}
              >
                {busy === "upload" ? <Spinner /> : <UploadSimpleIcon />}
                {current ? "Replace logo" : "Upload logo"}
              </Button>
              {current ? (
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  {busy === "remove" ? <Spinner /> : <TrashIcon />} Remove
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-logo-link">…or link to one you already host</Label>
            <div className="flex gap-2">
              <Input
                id="c-logo-link"
                value={link}
                placeholder="https://example.com/logo.png"
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void applyLink();
                }}
              />
              <Button
                variant="outline"
                disabled={busy !== null || !link.trim()}
                onClick={() => void applyLink()}
              >
                {busy === "link" ? <Spinner /> : <LinkIcon />} Use link
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A square or wide mark on a transparent background reads best.
              PNG, SVG, JPG or WebP, up to 2 MB.
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------- previews */}
        <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:w-[26rem]">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Sidebar
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-sidebar p-2">
              <CompanyLogo src={current} />
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-medium">
                  {workspace.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {workspace.industry ?? workspace.locale}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Web chat
            </p>
            {/* The widget's header, drawn the way app/widget draws it. */}
            <div className="flex items-center gap-2.5 overflow-hidden rounded-lg bg-primary p-2 text-primary-foreground">
              <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
                {current ? (
                  <img
                    src={current}
                    alt=""
                    className="size-full object-contain p-0.5"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-[10px] font-semibold text-primary">
                    AI
                  </span>
                )}
              </div>
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-semibold">
                  {workspace.name}
                </span>
                <span className="truncate text-[11px] opacity-90">
                  Online · replies instantly
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
