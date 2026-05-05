import { NextRequest } from "next/server";

import { getApiBaseUrl } from "../../../../../lib/api";

type RouteContext = {
  params: Promise<{
    deviceId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { deviceId } = await context.params;
  const accessToken = request.nextUrl.searchParams.get("accessToken")?.trim();

  if (!accessToken) {
    return new Response("Missing access token.", { status: 401 });
  }

  const upstream = await fetch(`${getApiBaseUrl()}/devices/${deviceId}/camera-stream/mjpeg`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ??
        "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store"
    }
  });
}
