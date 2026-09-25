/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone: `next build` emits a self-contained server under .next/standalone,
  // which is what makes deployment "copy a folder, run node server.js" on any
  // Node host — the share server is meant to live on a plain VPS, not on a
  // platform that owns the runtime.
  output: 'standalone',
  // The public entry is cinaka.com/poe2/ (nginx proxies that path to the app and
  // terminates TLS), so every route and asset the app emits carries this prefix.
  // This MUST match the nginx location block; it used to be patched by hand on
  // the server, which a from-git.sh rebuild would silently wipe — it lives here
  // now, in the source of truth.
  basePath: '/poe2',
}

export default nextConfig
