export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    // Neon's pooler hostname resolves to both IPv4 and IPv6 addresses.
    // Node.js may try IPv6 first and hang if the local network lacks IPv6 connectivity.
    // Must run before any pg Pool is created.
    dns.setDefaultResultOrder("ipv4first");
  }
}
