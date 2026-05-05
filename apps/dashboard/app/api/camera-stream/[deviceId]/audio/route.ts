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
  const sinceSeqRaw = request.nextUrl.searchParams.get("sinceSeq")?.trim();
  const limitRaw = request.nextUrl.searchParams.get("limit")?.trim();

  if (!accessToken) {
    return new Response("Missing access token.", { status: 401 });
  }

  const searchParams = new URLSearchParams();
  if (sinceSeqRaw) {
    searchParams.set("sinceSeq", sinceSeqRaw);
  }
  if (limitRaw) {
    searchParams.set("limit", limitRaw);
  }

  const upstream = await fetch(
    `${getApiBaseUrl()}/devices/${deviceId}/camera-stream/audio?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store"
    }
  });
}
