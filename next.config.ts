import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    // Dish photos are resized and converted to WebP before they reach R2 and are served
    // from Cloudflare's CDN, so Vercel's image optimiser would only add cost and latency.
    unoptimized: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default config;
