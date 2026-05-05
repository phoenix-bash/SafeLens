interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  accessToken?: string;
  timeoutMs?: number;
}

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method || "GET",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) {
        message = payload.message.join(", ");
      } else if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore JSON parsing errors and keep the fallback message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function isSessionExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}
