import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: ["xlsx", "nodemailer"],
  env: {
    NEXT_PUBLIC_HANDOFF_TZ: process.env.HANDOFF_TZ?.trim() || "UTC",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    middlewareClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
