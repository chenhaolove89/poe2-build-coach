/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone: `next build` emits a self-contained server under .next/standalone,
  // which is what makes deployment "copy a folder, run node server.js" on any
  // Node host — the share server is meant to live on a plain VPS, not on a
  // platform that owns the runtime.
  output: 'standalone',
}

export default nextConfig
