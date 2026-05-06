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
  if (Object.prototype.hasOwnProperty.call(options, "accessToken")) {
    const normalizedToken = options.accessToken?.trim();
    if (!normalizedToken) {
      throw new Error("Missing access token. Please sign in again.");
    }
  }

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
        ...(Object.prototype.hasOwnProperty.call(options, "accessToken")
          ? { Authorization: `Bearer ${options.accessToken?.trim()}` }
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
      const payload = (await response.json()) as {
        message?: string | string[] | Record<string, unknown>;
      };
      if (Array.isArray(payload.message)) {
        message = payload.message.join(", ");
      } else if (payload.message) {
        if (typeof payload.message === "string") {
          message = payload.message;
        } else if (typeof payload.message === "object") {
          const fieldErrors =
            "fieldErrors" in payload.message &&
            payload.message.fieldErrors &&
            typeof payload.message.fieldErrors === "object"
              ? (payload.message.fieldErrors as Record<string, unknown>)
              : null;
          if (fieldErrors) {
            const parts = Object.entries(fieldErrors)
              .map(([field, detail]) => {
                if (Array.isArray(detail)) {
                  return `${field}: ${detail.join(" | ")}`;
                }
                return `${field}: ${String(detail)}`;
              })
              .filter((part) => part.trim().length > 0);
            if (parts.length) {
              message = parts.join("; ");
            }
          }
          if (message.startsWith("Request failed") && "formErrors" in payload.message) {
            const formErrors = payload.message.formErrors;
            if (Array.isArray(formErrors) && formErrors.length) {
              message = formErrors.join("; ");
            }
          }
        }
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
