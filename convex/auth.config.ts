// Session JWTs are minted and signed by this deployment itself (see
// convex/auth.ts) and verified against the JWKS served from convex/http.ts.
// Pointing `domain` at our own .convex.site keeps the whole flow inside Convex,
// so it works in local development with no tunnel and no external IdP.
const siteUrl =
  process.env.CONVEX_SITE_URL ?? "https://example.convex.site";

const authConfig = {
  providers: [
    {
      domain: siteUrl,
      applicationID: "magic-ai-bot",
    },
  ],
};

export default authConfig;
