import { networkInterfaces } from "node:os";

import { NextResponse } from "next/server";

const PRIVATE_IPV4_PREFIXES = ["10.", "172.", "192.168."];

function pickLocalIpv4() {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        PRIVATE_IPV4_PREFIXES.some((prefix) => entry.address.startsWith(prefix))
      ) {
        return entry.address;
      }
    }
  }

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return null;
}

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ip: pickLocalIpv4() },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
