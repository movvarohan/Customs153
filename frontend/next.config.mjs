/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* to the backend so the browser only ever talks to the
  // frontend's own origin. A single forwarded port (3000) then runs the
  // whole app — no separate backend port to forward, no CORS, and it works
  // through any tunnel / preview URL.
  //
  // Override the backend host with API_PROXY_TARGET; defaults to
  // localhost:8787 on the same machine.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET ?? "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
