import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the file-tracing root to this app. The repo has another lockfile (root
  // package.json for the ppt/ slide generator); without this, Next infers the
  // wrong workspace root and warns on every start.
  outputFileTracingRoot: path.join(__dirname),
  // Hide the floating dev-tools "N" indicator (bottom-left) for clean demos.
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "hadsgawgroliejibuvxh.supabase.co",
      },
    ],
  },
};

export default nextConfig;
