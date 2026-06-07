import type {
  IdentityRequest,
  IdentityResponse,
  RoomDetailOut,
  RoomOut,
  RoundCreateRequest,
  RoundOut,
  SubmissionOut,
} from "@/lib/types";

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  userId?: string;
};

export async function apiRequest<TResponse>(
  path: string,
  options: ApiOptions = {},
  apiBaseUrl = DEFAULT_API_BASE_URL,
): Promise<TResponse> {
  const url = `${trimTrailingSlash(apiBaseUrl)}${path}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (options.userId) {
    headers["X-User-Id"] = options.userId;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new Error(formatNetworkError(url, error));
  }

  if (!response.ok) {
    const message = await readErrorMessage(response, url);
    throw new Error(message);
  }

  return response.json() as Promise<TResponse>;
}

export function identify(payload: IdentityRequest, apiBaseUrl?: string): Promise<IdentityResponse> {
  return apiRequest<IdentityResponse>("/identity", {
    method: "POST",
    body: payload,
  }, apiBaseUrl);
}

export function createRoom(userId: string, apiBaseUrl?: string): Promise<RoomOut> {
  return apiRequest<RoomOut>("/rooms", {
    method: "POST",
    userId,
  }, apiBaseUrl);
}

export function joinRoom(code: string, userId: string, apiBaseUrl?: string): Promise<RoomDetailOut> {
  return apiRequest<RoomDetailOut>(`/rooms/${encodeURIComponent(code)}/join`, {
    method: "POST",
    userId,
  }, apiBaseUrl);
}

export function getRoom(code: string, userId: string, apiBaseUrl?: string): Promise<RoomDetailOut> {
  return apiRequest<RoomDetailOut>(`/rooms/${encodeURIComponent(code)}`, {
    method: "GET",
    userId,
  }, apiBaseUrl);
}

export function createRound(
  code: string,
  payload: RoundCreateRequest,
  userId: string,
  apiBaseUrl?: string,
): Promise<RoundOut> {
  return apiRequest<RoundOut>(`/rooms/${encodeURIComponent(code)}/rounds`, {
    method: "POST",
    userId,
    body: payload,
  }, apiBaseUrl);
}

export function startRound(
  code: string,
  roundId: string,
  userId: string,
  apiBaseUrl?: string,
): Promise<RoundOut> {
  return apiRequest<RoundOut>(`/rooms/${encodeURIComponent(code)}/rounds/${encodeURIComponent(roundId)}/start`, {
    method: "PATCH",
    userId,
  }, apiBaseUrl);
}

export function submitPrompt(
  roundId: string,
  promptText: string,
  userId: string,
  apiBaseUrl?: string,
): Promise<SubmissionOut> {
  return apiRequest<SubmissionOut>(`/rounds/${encodeURIComponent(roundId)}/submissions`, {
    method: "POST",
    userId,
    body: { prompt_text: promptText },
  }, apiBaseUrl);
}

export function scoreSubmission(
  submissionId: string,
  score: number,
  userId: string,
  apiBaseUrl?: string,
): Promise<SubmissionOut> {
  return apiRequest<SubmissionOut>(`/submissions/${encodeURIComponent(submissionId)}/score`, {
    method: "PATCH",
    userId,
    body: { score },
  }, apiBaseUrl);
}

export function eliminateParticipant(
  submissionId: string,
  userId: string,
  apiBaseUrl?: string,
): Promise<SubmissionOut> {
  return apiRequest<SubmissionOut>(`/submissions/${encodeURIComponent(submissionId)}/eliminate`, {
    method: "PATCH",
    userId,
  }, apiBaseUrl);
}

async function readErrorMessage(response: Response, url: string): Promise<string> {
  const responseBody = await response.text();
  const detail = parseErrorDetail(responseBody);

  return [
    `Request failed: ${response.status} ${response.statusText || "Unknown status"}`,
    `URL: ${url}`,
    detail ? `Response: ${detail}` : responseBody ? `Response: ${responseBody}` : "Response: <empty>",
  ].join("\n");
}

function parseErrorDetail(responseBody: string): string | null {
  if (!responseBody) return null;

  try {
    const data: unknown = JSON.parse(responseBody);
    if (isObject(data) && typeof data.detail === "string") {
      return data.detail;
    }
    if (isObject(data) && data.detail !== undefined) {
      return JSON.stringify(data.detail);
    }
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function formatNetworkError(url: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    "Cannot reach backend API.",
    `URL: ${url}`,
    `Network error: ${detail}`,
    "Check that FastAPI is running on http://127.0.0.1:8000 and that the API base URL is correct.",
  ].join("\n");
}

function isObject(value: unknown): value is { detail?: unknown } {
  return typeof value === "object" && value !== null;
}
