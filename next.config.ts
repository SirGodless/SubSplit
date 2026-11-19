import type { NextConfig } from "next";

// Die Content-Security-Policy setzt src/proxy.ts (die Adresse des Hubs steht erst zur Laufzeit fest).

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Kein X-Frame-Options: Es würde das Einbetten im Hub verbieten. Der Schutz vor fremden Rahmen ist frame-ancestors in der CSP.
          // Adressen mit Token (Abmelde-Link) dürfen nie als Referer an andere Seiten gehen.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
