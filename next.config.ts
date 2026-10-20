import type { NextConfig } from "next";

const photoHost = process.env.NEXT_PUBLIC_PHOTO_BASE_URL
  ? new URL(process.env.NEXT_PUBLIC_PHOTO_BASE_URL).hostname
  : undefined;

const config: NextConfig = {
  images: {
    remotePatterns: photoHost ? [{ protocol: "https", hostname: photoHost }] : [],
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default config;
