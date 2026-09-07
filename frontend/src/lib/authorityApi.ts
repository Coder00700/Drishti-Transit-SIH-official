let csrf = "";
export type Authority = {
  id: string;
  secure_id: string;
  name: string;
  area_id: string;
  level: "GLOBAL" | "DISTRICT" | "LOCAL";
  slot: number;
  status?: "ACTIVE" | "INVITED";
  must_change_password?: boolean;
  credential_scope?: "LOCAL_ONLY" | "STANDARD";
};
export type Area = {
  id: string;
  name: string;
  level: string;
  parent_id: string | null;
};
export type Publication = {
  id: string;
  area_id: string;
  kind: "HIGHLIGHT" | "ALERT" | "REPORT";
  title: string;
  summary: string;
  status: string;
  category: string;
  source: string;
  resolution_note: string;
  expires_at: string | null;
  revision: number;
  publication: string;
  updated_at: string;
};
export type RoadImport = {
  id: string;
  area_id: string;
  filename: string;
  count: number;
  status: string;
  created_at: string;
};
export type Recording = {
  id: string;
  area_id: string;
  filename: string;
  byte_size: number;
  duration_ms: number;
  status: string;
  quality: { max_gap_ms: number; max_accuracy_m: number };
  source_type: string;
  review_note?: string;
};
export type ResearchCandidate = {
  id: string; area_id: string; title: string; source_url: string; kind: string;
  status: string; publication: string; photo_proof_url: string | null; notice: string;
};
export type ReportRequest = {
  id: string; area_id: string; request_type: string; requested_role: string;
  status: string; instructions: string;
};
export class AuthorityError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
export async function authorityRequest<T>(
  path: string,
  method = "GET",
  data?: unknown
): Promise<T> {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const response = await fetch("/api/v1/authority" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
    headers: mutation
      ? { "Content-Type": "application/json", "X-Authority-CSRF": csrf }
      : {},
    body: mutation ? JSON.stringify(data ?? {}) : undefined,
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new AuthorityError("The authority service is not connected.", 503);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) csrf = "";
    throw new AuthorityError(
      typeof result.detail === "string"
        ? result.detail
        : "Check the required fields and try again.",
      response.status
    );
  }
  if (result.csrf) csrf = result.csrf;
  if (path === "/logout") csrf = "";
  return result;
}

