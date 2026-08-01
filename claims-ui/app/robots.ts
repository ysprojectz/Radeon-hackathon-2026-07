import type { MetadataRoute } from "next";

/**
 * Disallow all crawlers — this is an internal claims-processing portal,
 * not a public-facing website. Content must never appear in search indices.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
