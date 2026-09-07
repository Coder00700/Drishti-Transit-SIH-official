import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  FileUp,
  Film,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Radio,
  ShieldCheck,
  Users,
  History,
  LoaderCircle,
  Search,
  BookOpenCheck,
  Plus,
  X,
} from "lucide-react";
import {
  authorityRequest as api,
  AuthorityError,
  type Authority,
  type Area,
  type Publication,
  type RoadImport,
  type Recording,
  type ResearchCandidate,
  type ReportRequest,
} from "@/lib/authorityApi";
import "./authority.css";

type Metrics = {
  drafts: number;
  published: number;
  evidence_pending: number;
  datasets: number;
  open_report_requests: number;
  research_candidates: number;
};
type HistoryItem = {
  actor_id: string;
  action: string;
  at: string;
  target: string;
  area_id: string;
};
const navigation = [
  ["overview", "Overview", LayoutDashboard],
  ["publications", "Public updates", Radio],
  ["imports", "Road datasets", MapPinned],
  ["recordings", "Recording inbox", Film],
  ["team", "Authority directory", Users],
  ["research", "Source review", BookOpenCheck],
  ["audit", "Activity log", History],
] as const;
const initial = {
  area_id: "",
  kind: "HIGHLIGHT",
  title: "",
  summary: "",
  status: "REPORTED",
  category: "PROJECT",
  source: "",
  resolution_note: "",
  expires_at: "",
};
const label = (text: string) =>
  text
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, c => c.toUpperCase());
const date = (value: string) => new Date(value).toLocaleString();

export default function AuthorityDesk() {
  const sessionGeneration = useRef(0);
  const [location, navigate] = useLocation();
  const section = location.split("/")[2] || "overview";
  const [admin, setAdmin] = useState<Authority | null>(null),
    [areas, setAreas] = useState<Area[]>([]),
    [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [metrics, setMetrics] = useState<Metrics>({
    drafts: 0,
    published: 0,
    evidence_pending: 0,
    datasets: 0,
    open_report_requests: 0,
    research_candidates: 0,
  });
  const [content, setContent] = useState<Publication[]>([]),
    [imports, setImports] = useState<RoadImport[]>([]),
    [recordings, setRecordings] = useState<Recording[]>([]),
    [team, setTeam] = useState<Authority[]>([]),
    [events, setEvents] = useState<HistoryItem[]>([]),
    [research, setResearch] = useState<ResearchCandidate[]>([]),
    [reportRequests, setReportRequests] = useState<ReportRequest[]>([]);
  const [filter, setFilter] = useState(""),
    [search, setSearch] = useState(""),
    [form, setForm] = useState(initial),
    [editing, setEditing] = useState<Publication | null>(null),
    [editor, setEditor] = useState(false);
  const [preview, setPreview] = useState<{
      id: string;
      active_batch_id: string | null;
      preview: unknown[];
    } | null>(null),
    [reviewNote, setReviewNote] = useState("");
  async function refresh() {
    const generation = sessionGeneration.current;
    const [a, m, c, i, r, t, h, sources, requests] = await Promise.all([
      api<Area[]>("/areas"),
      api<Metrics>("/dashboard"),
      api<Publication[]>("/content"),
      api<RoadImport[]>("/imports"),
      api<Recording[]>("/evidence"),
      api<Authority[]>("/team"),
      api<HistoryItem[]>("/audit"),
      api<ResearchCandidate[]>("/research"),
      api<ReportRequest[]>("/report-requests"),
    ]);
    if (generation !== sessionGeneration.current) return;
    setAreas(a);
    setMetrics(m);
    setContent(c);
    setImports(i);
    setRecordings(r);
    setTeam(t);
    setEvents(h);
    setResearch(sources);
    setReportRequests(requests);
  }
  function clearPrivateState() {
    sessionGeneration.current++;
    setContent([]);
    setImports([]);
    setRecordings([]);
    setTeam([]);
    setResearch([]);
    setReportRequests([]);
    setEvents([]);
    setAreas([]);
    setPreview(null);
    setEditor(false);
    setEditing(null);
    setForm(initial);
    setMetrics({ drafts: 0, published: 0, evidence_pending: 0, datasets: 0,
      open_report_requests: 0, research_candidates: 0 });
  }
  function handleError(e: unknown) {
    if (e instanceof AuthorityError && e.status === 401) {
      clearPrivateState();
      setAdmin(null);
      navigate("/admin/login");
    }
    setError((e as Error).message);
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    api<{ demo: boolean }>("/capabilities")
      .then(x => {
        if (live) setDemo(x.demo);
      })
      .catch(() => {});
    api<{ admin: Authority }>("/me")
      .then(x => {
        if (live) {
          setAdmin(x.admin);
          if (location === "/admin/login") navigate("/admin");
        }
      })
      .catch(e => {
        if (live && e.status !== 401) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (admin) void perform(refresh);
  }, [admin]);
  const areaName = (id: string) =>
    areas.find(a => a.id === id)?.name || label(id.replaceAll("-", " "));
  const scopedContent = content.filter(
    c =>
      (!filter || c.area_id === filter) &&
      `${c.title} ${c.summary}`.toLowerCase().includes(search.toLowerCase())
  );
  function openEditor(item?: Publication) {
    setEditing(item || null);
    setForm(
      item
        ? {
            ...item,
            expires_at: item.expires_at
              ? new Date(
                  new Date(item.expires_at).getTime() -
                    new Date().getTimezoneOffset() * 60000
                )
                  .toISOString()
                  .slice(0, 16)
              : "",
          }
        : { ...initial, area_id: admin?.area_id || "" }
    );
    setEditor(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await perform(async () => {
      const body = {
        ...form,
        expires_at: form.expires_at
          ? new Date(form.expires_at).toISOString()
          : null,
      };
      // Send an explicit allowlist; no UI-only/server-owned fields can be posted.
      const fields = {
        area_id: body.area_id,
        kind: body.kind,
        title: body.title,
        summary: body.summary,
        status: body.status,
        category: body.category,
        source: body.source,
        resolution_note: body.resolution_note,
        expires_at: body.expires_at,
      };
      await api(
        editing ? "/content/" + editing.id : "/content",
        editing ? "PUT" : "POST",
        editing ? { ...fields, revision: editing.revision } : fields
      );
      setEditor(false);
      await refresh();
      setNotice("Draft saved. Review it before publishing.");
    });
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file") as File;
    await perform(async () => {
      if (!file || file.size > 1800000)
        throw new Error(
          "Choose a GeoJSON, JSON or CSV file smaller than 1.8 MB."
        );
      const result = await api<RoadImport>("/imports", "POST", {
        area_id: data.get("area_id"),
        filename: file.name,
        content: await file.text(),
      });
      await refresh();
      setPreview(await api("/imports/" + result.id));
      setNotice("Dataset validated. Inspect the preview before publishing.");
    });
  }
  const input = (key: keyof typeof initial, value: string) =>
    setForm(p => ({ ...p, [key]: value }));
  if (loading)
    return (
      <div className="authority-loading">
        <LoaderCircle className="animate-spin" />
        Checking authority session…
      </div>
    );
  if (!admin)
    return (
      <div className="authority-login">
        <section className="authority-login-story">
          <Link href="/" className="authority-brand">
            <ShieldCheck />
            DRISHTI <span>AUTHORITY NETWORK</span>
          </Link>
          <div>
            <p className="authority-kicker">
              CONNECTED ROADS. ACCOUNTABLE ACTION.
            </p>
            <h1>
              A clearer view.
              <br />A shared responsibility.
            </h1>
            <p>
              One workspace for Delhi’s road authorities. Turn verified
              observations into visible progress, from a single street to the
              city.
            </p>
            <div className="authority-hierarchy">
              <span>
                Delhi<small>City authority</small>
              </span>
              <ChevronRight />
              <span>
                West Delhi<small>District oversight</small>
              </span>
              <ChevronRight />
              <span>
                Nangloi<small>Local operations</small>
              </span>
            </div>
          </div>
          <p className="authority-story-footer">
            Drishti Transit · Road intelligence & public works
          </p>
        </section>
        <section className="authority-login-panel">
          <div className="authority-login-form">
            <div className="authority-seal">
              <Building2 size={26} />
            </div>
            <p className="authority-kicker">AUTHORIZED PERSONNEL</p>
            <h2>Welcome to your desk</h2>
            <p>
              Sign in with the secure ID assigned by your project operator. Your
              jurisdiction is linked to your account.
            </p>
            {error && (
              <div role="alert" className="authority-error">
                {error}
              </div>
            )}
            <form
              onSubmit={e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  const x = await api<{ admin: Authority }>("/login", "POST", {
                    secure_id: f.get("secure_id"),
                    password: f.get("password"),
                  });
                  setAdmin(x.admin);
                  navigate("/admin");
                });
              }}
            >
              <label>
                Secure ID
                <input
                  name="secure_id"
                  required
                  autoComplete="username"
                  placeholder="Enter your assigned ID"
                  maxLength={32}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  required
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  maxLength={128}
                />
              </label>
              <button className="authority-primary" disabled={busy}>
                {busy ? "Signing in…" : "Sign in to workspace"}
                <ArrowUpRight size={18} />
              </button>
            </form>
            <p className="authority-help">
              Need access? Contact your project operator for an individual
              account.
            </p>
            {demo && (
              <details className="authority-demo">
                <summary>Local demonstration accounts</summary>
                <p>Temporary data. Resets when the demo service stops.</p>
                <p>
                  ID: <code>delhi-1</code>, <code>west-delhi-1</code>, or{" "}
                  <code>nangloi-1</code>
                  <br />
                  Password: <code>Demo-Authority-2026!</code>
                </p>
              </details>
            )}
            <Link href="/">← Return to public portal</Link>
          </div>
        </section>
      </div>
    );
  return (
    <div className="authority-shell">
      <aside className="authority-sidebar">
        <Link href="/admin" className="authority-brand">
          <ShieldCheck />
          DRISHTI<span>AUTHORITY NETWORK</span>
        </Link>
        <div className="authority-scope">
          <small>YOUR JURISDICTION</small>
          <strong>{areaName(admin.area_id)}</strong>
          <span>
            {label(admin.level)} authority · Admin {admin.slot}
          </span>
        </div>
        <nav aria-label="Authority navigation">
          {navigation.map(([key, title, Icon]) => (
            <Link
              key={key}
              href={"/admin/" + (key === "overview" ? "" : key)}
              className={section === key ? "active" : ""}
            >
              <Icon size={18} />
              {title}
              {key === "recordings" && metrics.evidence_pending > 0 && (
                <b>{metrics.evidence_pending}</b>
              )}
            </Link>
          ))}
        </nav>
        <div className="authority-sidebar-bottom">
          <Link href="/gis">
            <MapPinned size={17} />
            Public road map
            <ArrowUpRight size={15} />
          </Link>
          <div className="authority-account">
            <span>{admin.name.slice(0, 1)}</span>
            <div>
              <strong>{admin.name}</strong>
              <small>{admin.secure_id}</small>
            </div>
            <button
              aria-label="Sign out"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api("/logout", "POST");
                  clearPrivateState();
                  setAdmin(null);
                  navigate("/admin/login");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="authority-workspace">
        <header className="authority-topbar">
          <span>
            Authority network <ChevronRight size={14} />{" "}
            {areaName(admin.area_id)}
          </span>
          <span>
            <i />
            {demo ? "Local demonstration" : "Connected workspace"}
          </span>
        </header>
        <main>
          <div className="authority-heading">
            <div>
              <p className="authority-kicker">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <h1>
                {navigation.find(n => n[0] === section)?.[1] || "Overview"}
              </h1>
              <p>
                {section === "overview"
                  ? "The work that matters, across your jurisdiction."
                  : "Review, coordinate and publish with a clear record of every action."}
              </p>
            </div>
            <button
              disabled={busy}
              className="authority-secondary"
              onClick={() => void perform(refresh)}
            >
              {busy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : null}
              Refresh
            </button>
          </div>
          {error && (
            <p role="alert" className="authority-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="authority-success">
              <Check size={16} />
              {notice}
            </p>
          )}
          {demo && (
            <p className="authority-banner">
              Local preview · Changes stay in this temporary workspace. Nothing
              is published to the live website.
            </p>
          )}
          {admin.must_change_password && (
            <p role="status" className="authority-banner">
              Temporary local credential · Change this password before this
              account is ever enabled outside the core network.
            </p>
          )}
          {section === "overview" && (
            <>
              <section className="authority-metrics">
                {[
                  [metrics.drafts, "Draft updates", "Ready for your review"],
                  [
                    metrics.published,
                    "Published updates",
                    "Visible through the public API",
                  ],
                  [
                    metrics.evidence_pending,
                    "Recordings to review",
                    "Consent checked before access",
                  ],
                  [
                    metrics.datasets,
                    "Validated datasets",
                    "Awaiting or available for publication",
                  ],
                ].map(([n, title, desc]) => (
                  <article key={title}>
                    <span>{title}</span>
                    <strong>{n}</strong>
                    <small>{desc}</small>
                  </article>
                ))}
              </section>
              <section className="authority-overview-grid">
                <article className="authority-card authority-action-card">
                  <div className="authority-section-title">
                    <h2>From observation to action</h2>
                    <span className="authority-tag">YOUR WORKFLOW</span>
                  </div>
                  <div className="authority-workflow">
                    {[
                      [
                        "01",
                        "Receive & review",
                        "Review contributor footage and its GPS coverage.",
                      ],
                      [
                        "02",
                        "Coordinate the response",
                        "Create a report, assign its progress and record the source.",
                      ],
                      [
                        "03",
                        "Publish the outcome",
                        "Share verified updates and resolved work with residents.",
                      ],
                    ].map(([n, t, d]) => (
                      <div key={n}>
                        <b>{n}</b>
                        <section>
                          <h3>{t}</h3>
                          <p>{d}</p>
                        </section>
                      </div>
                    ))}
                  </div>
                  <button
                    className="authority-primary"
                    onClick={() => {
                      navigate("/admin/publications");
                      openEditor();
                    }}
                  >
                    Create a public update
                    <Plus size={17} />
                  </button>
                </article>
                <article className="authority-card">
                  <div className="authority-section-title">
                    <h2>Your operating areas</h2>
                    <Building2 size={18} />
                  </div>
                  {areas.map(a => (
                    <div key={a.id} className="authority-area-row">
                      <span
                        className={
                          "authority-area-dot " + a.level.toLowerCase()
                        }
                      />
                      <div>
                        <strong>{a.name}</strong>
                        <small>
                          {label(a.level)} ·{" "}
                          {a.parent_id
                            ? areaName(a.parent_id)
                            : "City-wide oversight"}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </div>
                  ))}
                  <p className="authority-footnote">
                    Operating areas follow the project hierarchy. Official
                    administrative boundaries must be verified before production
                    rollout.
                  </p>
                </article>
              </section>
              <article className="authority-card">
                <div className="authority-section-title">
                  <h2>Latest updates</h2>
                  <Link href="/admin/publications">
                    View all <ArrowUpRight size={15} />
                  </Link>
                </div>
                {content.slice(0, 4).map(c => (
                  <div className="authority-update-row" key={c.id}>
                    <span className="authority-tag">{label(c.kind)}</span>
                    <strong>{c.title}</strong>
                    <span>{areaName(c.area_id)}</span>
                    <span
                      className={
                        "authority-status " + c.publication.toLowerCase()
                      }
                    >
                      {label(c.publication)}
                    </span>
                  </div>
                ))}
                {!content.length && (
                  <Empty
                    title="Your first update starts here"
                    text="Create a highlight, report or urgent alert when verified information is available."
                  />
                )}
              </article>
            </>
          )}
          {section === "publications" && (
            <>
              <div className="authority-toolbar">
                <div className="authority-search">
                  <Search size={17} />
                  <input
                    aria-label="Search updates"
                    placeholder="Search updates…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filter locality"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  <option value="">All my areas</option>
                  {areas.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  className="authority-primary"
                  onClick={() => openEditor()}
                >
                  <Plus size={16} />
                  New update
                </button>
              </div>
              <div className="authority-publication-grid">
                {scopedContent.map(c => (
                  <article className="authority-card" key={c.id}>
                    <div className="authority-section-title">
                      <span className="authority-tag">
                        {label(c.kind)} · {areaName(c.area_id)}
                      </span>
                      <span
                        className={
                          "authority-status " + c.publication.toLowerCase()
                        }
                      >
                        {label(c.publication)}
                      </span>
                    </div>
                    <h2>{c.title}</h2>
                    <p className="authority-summary">{c.summary}</p>
                    <p className="authority-footnote">
                      {label(c.status)} · Source: {c.source}
                    </p>
                    {c.expires_at && (
                      <p className="authority-footnote">
                        Expires {date(c.expires_at)}
                      </p>
                    )}
                    <div className="authority-card-actions">
                      <button
                        disabled={busy}
                        className="authority-secondary"
                        onClick={() => openEditor(c)}
                      >
                        Edit draft
                      </button>
                      <button
                        disabled={busy}
                        className="authority-primary"
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              "/content/" + c.id + "/transition",
                              "POST",
                              {
                                revision: c.revision,
                                action:
                                  c.publication === "PUBLISHED"
                                    ? "withdraw"
                                    : "publish",
                              }
                            );
                            await refresh();
                            setNotice("Publication updated.");
                          })
                        }
                      >
                        {c.publication === "PUBLISHED" ? "Withdraw" : "Publish"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!scopedContent.length && (
                <Empty
                  title="No updates yet"
                  text="Publish locality highlights, work progress and alerts from this desk."
                />
              )}
            </>
          )}
          {section === "imports" && (
            <>
              <article className="authority-card">
                <div className="authority-section-title">
                  <div>
                    <h2>Publish assessed road data</h2>
                    <p className="authority-summary">
                      Upload one locality’s complete road snapshot. A new
                      publication replaces that locality’s previous snapshot.
                    </p>
                  </div>
                  <FileUp />
                </div>
                {admin.level === "GLOBAL" ? (
                  <form className="authority-import-form" onSubmit={upload}>
                    <label>
                      Locality
                      <select name="area_id" required>
                        <option value="">Select locality</option>
                        {areas
                          .filter(a => a.level === "LOCAL")
                          .map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Road dataset
                      <input
                        name="file"
                        required
                        type="file"
                        accept=".geojson,.json,.csv"
                      />
                    </label>
                    <button disabled={busy} className="authority-primary">
                      Validate upload
                      <FileUp size={16} />
                    </button>
                  </form>
                ) : (
                  <p className="authority-banner">
                    Delhi’s global authority manages road imports. You can
                    inspect datasets for your operating areas.
                  </p>
                )}
                <p className="authority-footnote">
                  GeoJSON, JSON or CSV · up to 1,000 observations / 1.8 MB ·
                  WGS84 Point or LineString · severity, confidence, model
                  version and observation time required.
                </p>
              </article>
              <article className="authority-card">
                <h2>Dataset history</h2>
                {imports.map(i => (
                  <div className="authority-update-row" key={i.id}>
                    <div>
                      <strong>{i.filename}</strong>
                      <small>
                        {areaName(i.area_id)} · {i.count} observations
                      </small>
                    </div>
                    <span className="authority-tag">{i.status}</span>
                    <button
                      className="authority-secondary"
                      onClick={() =>
                        void perform(async () =>
                          setPreview(await api("/imports/" + i.id))
                        )
                      }
                    >
                      Inspect
                    </button>
                  </div>
                ))}
                {!imports.length && (
                  <Empty
                    title="No imported road layers"
                    text="Validated layers will appear here before they reach the public map."
                  />
                )}
              </article>
              {preview && (
                <article className="authority-card">
                  <div className="authority-section-title">
                    <h2>Dataset review</h2>
                    <button
                      aria-label="Close preview"
                      onClick={() => setPreview(null)}
                    >
                      <X />
                    </button>
                  </div>
                  <p className="authority-summary">
                    Preview of the first 20 observations. Confirm locality,
                    geometry and model confidence before publishing.
                  </p>
                  <pre className="authority-code">
                    {JSON.stringify(preview.preview, null, 2)}
                  </pre>
                  {admin.level === "GLOBAL" && (
                    <button
                      disabled={busy}
                      className="authority-primary"
                      onClick={() =>
                        void perform(async () => {
                          await api(
                            "/imports/" + preview.id + "/publish",
                            "POST",
                            { expected_batch_id: preview.active_batch_id }
                          );
                          setPreview(null);
                          await refresh();
                          setNotice(
                            "Road snapshot published to this workspace’s public API."
                          );
                        })
                      }
                    >
                      Publish this snapshot
                      <ArrowUpRight size={17} />
                    </button>
                  )}
                </article>
              )}
            </>
          )}
          {section === "recordings" && (
            <>
              <article className="authority-card">
                <h2>Contributor recording review</h2>
                <p className="authority-summary">
                  Only footage shared with your authority and backed by active
                  contributor consent appears here. Recording GPS describes
                  where the video was captured.
                </p>
                <label>
                  Review note
                  <textarea
                    placeholder="Record what you checked and why you accept or reject the footage."
                    value={reviewNote}
                    onChange={e => setReviewNote(e.target.value)}
                    maxLength={1000}
                  />
                </label>
              </article>
              {recordings.map(r => (
                <article className="authority-card" key={r.id}>
                  <div className="authority-section-title">
                    <div>
                      <h2>{r.filename}</h2>
                      <p className="authority-footnote">
                        {areaName(r.area_id)} ·{" "}
                        {(r.byte_size / 1024 / 1024).toFixed(1)} MB ·{" "}
                        {Math.round(r.duration_ms / 1000)} seconds ·{" "}
                        {r.source_type}
                      </p>
                    </div>
                    <span className="authority-tag">{r.status}</span>
                  </div>
                  <p className="authority-summary">
                    Maximum GPS gap: {(r.quality.max_gap_ms / 1000).toFixed(1)}{" "}
                    seconds · Worst reported accuracy: ±
                    {r.quality.max_accuracy_m.toFixed(0)} m
                  </p>
                  <div className="authority-card-actions">
                    <button
                      className="authority-secondary"
                      onClick={() =>
                        void perform(async () => {
                          const m = await api(
                            "/evidence/" + r.id + "/manifest"
                          );
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(m, null, 2)], {
                              type: "application/json",
                            })
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = r.id + "-gps.json";
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        })
                      }
                    >
                      GPS manifest
                    </button>
                    <button
                      className="authority-secondary"
                      onClick={() =>
                        void perform(async () => {
                          const x = await api<{ url: string }>(
                            "/evidence/" + r.id + "/download",
                            "POST"
                          );
                          window.open(x.url, "_blank", "noopener,noreferrer");
                        })
                      }
                    >
                      Open footage
                      <ArrowUpRight size={15} />
                    </button>
                    {["READY", "DRIVE_REFERENCE"].includes(r.status) &&
                      ["ACCEPTED", "REJECTED"].map(action => (
                        <button
                          className={
                            action === "ACCEPTED"
                              ? "authority-primary"
                              : "authority-secondary"
                          }
                          disabled={busy || reviewNote.trim().length < 5}
                          key={action}
                          onClick={() =>
                            void perform(async () => {
                              await api(
                                "/evidence/" + r.id + "/review",
                                "POST",
                                { action, note: reviewNote }
                              );
                              await refresh();
                              setReviewNote("");
                            })
                          }
                        >
                          {label(action)}
                        </button>
                      ))}
                  </div>
                </article>
              ))}
              {!recordings.length && (
                <Empty
                  title="Your recording inbox is clear"
                  text="Contributor submissions will appear here after upload, with their recorded GPS coverage."
                />
              )}
            </>
          )}
          {section === "team" && (
            <article className="authority-card">
              <h2>People & permissions</h2>
              <p className="authority-summary">
                Each person has their own ID. Authority is inherited through
                assigned operating areas.
              </p>
              {team.map(t => (
                <div className="authority-team-row" key={t.id}>
                  <div className="authority-avatar">{t.name[0]}</div>
                  <div>
                    <strong>{t.name}</strong>
                    <small>
                      {t.secure_id} · {areaName(t.area_id)}
                    </small>
                  </div>
                  <span className="authority-tag">{label(t.level)}</span>
                  <span>
                    {t.status === "INVITED"
                      ? "Activation pending · no login credential issued"
                      : t.level === "GLOBAL"
                      ? "Road publication + city updates"
                      : t.level === "DISTRICT"
                        ? "District updates + locality oversight"
                        : "Local updates + recording review"}
                  </span>
                </div>
              ))}
              <p className="authority-footnote">
                New accounts are provisioned by the operator. Localities support
                two individual admin slots.
              </p>
            </article>
          )}
          {section === "research" && (
            <>
              <article className="authority-card">
                <h2>Local map-report requests</h2>
                <p className="authority-summary">
                  Open requests ask both locality-admin slots for dated, located
                  and authorized evidence. They are internal tasks, not public reports.
                </p>
                {reportRequests.slice(0, 100).map(item => (
                  <div className="authority-update-row" key={item.id}>
                    <MapPinned size={17} />
                    <div>
                      <strong>{areaName(item.area_id)}</strong>
                      <small>{item.instructions}</small>
                    </div>
                    <span className="authority-tag">{label(item.status)}</span>
                  </div>
                ))}
                {!reportRequests.length && <Empty title="No map requests" text="No locality requests are in your scope." />}
              </article>
              <article className="authority-card">
                <h2>Official-source research queue</h2>
                <p className="authority-summary">
                  These links are research leads only. A tender or map is not proof
                  that work started, finished or remains active. Nothing here publishes automatically.
                </p>
                {research.map(item => (
                  <div className="authority-update-row" key={item.id}>
                    <BookOpenCheck size={17} />
                    <div>
                      <strong>{item.title}</strong>
                      <small>{areaName(item.area_id)} · {label(item.kind)}</small>
                    </div>
                    <a href={item.source_url} target="_blank" rel="noreferrer">Open source</a>
                  </div>
                ))}
                {!research.length && <Empty title="No source candidates" text="No verified public-source leads are in your scope." />}
              </article>
            </>
          )}
          {section === "audit" && (
            <article className="authority-card">
              <h2>Recent authority activity</h2>
              <p className="authority-summary">
                Latest 100 events from accessible records. Publication and
                review histories are stored with their records.
              </p>
              {events.map((e, i) => (
                <div className="authority-update-row" key={i}>
                  <History size={17} />
                  <div>
                    <strong>{label(e.action)}</strong>
                    <small>
                      {team.find(t => t.id === e.actor_id)?.name || e.actor_id}{" "}
                      · {areaName(e.area_id)}
                    </small>
                  </div>
                  <time>{date(e.at)}</time>
                </div>
              ))}
              {!events.length && (
                <Empty
                  title="No activity recorded"
                  text="Admin actions will appear here."
                />
              )}
            </article>
          )}
        </main>
        <footer className="authority-footer">
          Drishti Transit / Authority Network{" "}
          <span>Every update has an accountable author.</span>
        </footer>
      </div>
      {editor && (
        <div className="authority-modal-backdrop">
          <section
            className="authority-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
          >
            <div className="authority-section-title">
              <h2 id="editor-title">
                {editing ? "Edit update" : "Create public update"}
              </h2>
              <button
                aria-label="Close editor"
                onClick={() => setEditor(false)}
              >
                <X />
              </button>
            </div>
            <form onSubmit={save}>
              <div className="authority-form-grid">
                <label>
                  Operating area
                  <select
                    value={form.area_id}
                    disabled={!!editing}
                    onChange={e => input("area_id", e.target.value)}
                    required
                  >
                    <option value="">Choose area</option>
                    {areas.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Update type
                  <select
                    disabled={!!editing}
                    value={form.kind}
                    onChange={e => input("kind", e.target.value)}
                  >
                    {["HIGHLIGHT", "REPORT", "ALERT"].map(k => (
                      <option key={k} value={k}>
                        {label(k)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Public title
                <input
                  required
                  minLength={5}
                  maxLength={140}
                  value={form.title}
                  onChange={e => input("title", e.target.value)}
                />
              </label>
              <label>
                Public description
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={form.summary}
                  onChange={e => input("summary", e.target.value)}
                />
              </label>
              <div className="authority-form-grid">
                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={e => input("category", e.target.value)}
                  >
                    {[
                      "PROJECT",
                      "ACCIDENT",
                      "WATERLOGGING",
                      "RISK_ZONE",
                      "ROAD_REPAIR",
                    ].map(k => (
                      <option key={k} value={k}>
                        {label(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Work status
                  <select
                    value={form.status}
                    onChange={e => input("status", e.target.value)}
                  >
                    {["REPORTED", "IN_PROGRESS", "RESOLVED"].map(k => (
                      <option key={k} value={k}>
                        {label(k)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Public source / reference
                <input
                  required
                  minLength={3}
                  maxLength={300}
                  value={form.source}
                  onChange={e => input("source", e.target.value)}
                  placeholder="Authority bulletin or public report reference"
                />
              </label>
              {form.status === "RESOLVED" && (
                <label>
                  Resolution evidence summary
                  <textarea
                    required
                    minLength={10}
                    value={form.resolution_note}
                    onChange={e => input("resolution_note", e.target.value)}
                  />
                </label>
              )}
              {form.kind === "ALERT" && (
                <label>
                  Alert expires at
                  <input
                    required
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={e => input("expires_at", e.target.value)}
                  />
                </label>
              )}
              <p className="authority-footnote">
                These fields become public after publication. Include only
                information approved for residents.
              </p>
              {error && (
                <p role="alert" className="authority-error">
                  {error}
                </p>
              )}
              <button disabled={busy} className="authority-primary">
                Save draft
                <Check size={17} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="authority-empty">
      <div>
        <Check size={22} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

