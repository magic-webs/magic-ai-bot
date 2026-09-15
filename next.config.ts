import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Both are single barrels re-exporting thousands of icons — 6031 in
    // core-free-icons alone — and the workspace sidebar pulls from one of them
    // on every page. Without this, a dev rebuild walks the whole barrel and
    // rewrites far more chunks than the edit touched, which is what leaves the
    // browser holding module factories a new build no longer has. Next already
    // ships lucide-react in this list for the same reason; these two are not in
    // its defaults.
    optimizePackageImports: [
      "@hugeicons/core-free-icons",
      "@phosphor-icons/react",
    ],
  },
};

export default nextConfig;
