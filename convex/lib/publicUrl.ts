export function publicSiteUrl(): string {
  const site = process.env.PUBLIC_SITE_URL ?? process.env.CONVEX_SITE_URL ?? "";
  return site.replace(/\/$/, "");
}
