import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Camera, Download, MapPin, Square, Upload, Trash2 } from "lucide-react";
import { contributorRequest } from "@/lib/contributorApi";
import {
  saveRecording,
  listRecordings,
  saveChunk,
  recordingBlob,
  deleteRecording,
  downloadBlob,
  type SavedRecording,
  type GPSPoint,
} from "@/lib/recordingStore";
import "./authority.css";

export default function ContributorRecordings() {
  const [rows, setRows] = useState<SavedRecording[]>([]),
    [areas, setAreas] = useState<{ id: string; name: string }[]>([]),
    [area, setArea] = useState("");
  const [signedIn, setSignedIn] = useState(false),
    [consent, setConsent] = useState(false),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0),
    [accuracy, setAccuracy] = useState<number | null>(null),
    [drive, setDrive] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    camera = useRef<HTMLVideoElement | null>(null),
    streamRef = useRef<MediaStream | null>(null),
    mounted = useRef(true);
  const gpsWatch = useRef<number | null>(null),
    stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanup = () => {
    if (gpsWatch.current !== null)
      navigator.geolocation.clearWatch(gpsWatch.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (clock.current) clearInterval(clock.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };
  const refresh = async () =>
    setRows(
      (await listRecordings()).sort((a, b) =>
        b.recorded_at.localeCompare(a.recorded_at)
      )
    );
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(e => setError(e.message));
    contributorRequest("/me")
      .then(() => {
        setSignedIn(true);
        return contributorRequest<{ id: string; name: string }[]>(
          "/evidence/areas"
        );
      })
      .then(setAreas)
      .catch(() => {});
    const hidden = () => {
      if (document.hidden && recorder.current?.state === "recording") {
        recorder.current.stop();
        setNotice("Recording stopped because this page became hidden.");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", hidden);
      if (recorder.current?.state === "recording") recorder.current.stop();
      cleanup();
    };
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    await action(async () => {
      if (!consent) throw new Error("Accept device recording before starting.");
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices ||
        !window.MediaRecorder
      )
        throw new Error(
          "Use HTTPS or localhost in a browser that supports camera recording."
        );
      const estimate = await navigator.storage.estimate();
      if (
        estimate.quota &&
        estimate.quota - (estimate.usage || 0) < 120 * 1024 * 1024
      )
        throw new Error(
          "Less than 120 MB device storage remains. Export and remove old clips first."
        );
      await navigator.storage.persist?.();
      const fix = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        })
      );
      if (!mounted.current) return;
      setAccuracy(fix.coords.accuracy);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      try {
        if (!mounted.current || document.hidden) {
          cleanup();
          return;
        }
        if (camera.current) {
          camera.current.srcObject = stream;
          await camera.current.play();
        }
        const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find(
          t => MediaRecorder.isTypeSupported(t)
        );
        if (!mime)
          throw new Error("This browser has no supported recording format.");
        const rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 2500000,
        });
        recorder.current = rec;
        let startTime = Date.now();
        const id = crypto.randomUUID(),
          gps: GPSPoint[] = [];
        const row: SavedRecording = {
          id,
          filename:
            "road-" +
            new Date(startTime).toISOString().replaceAll(":", "-") +
            (mime.includes("mp4") ? ".mp4" : ".webm"),
          content_type: mime.includes("mp4") ? "video/mp4" : "video/webm",
          byte_size: 0,
          duration_ms: 0,
          recorded_at: new Date(startTime).toISOString(),
          gps,
          gps_offset_ms: 0,
          timing_source: "DEVICE_CAPTURE",
          chunks: 0,
          complete: false,
        };
        let writes = Promise.resolve(),
          storageFailed = false,
          index = 0;
        await saveRecording(row);
        if (!mounted.current || document.hidden) {
          cleanup();
          return;
        }
        rec.ondataavailable = e => {
          if (!e.data.size) return;
          const n = index++;
          row.byte_size += e.data.size;
          writes = writes
            .then(async () => {
              await saveChunk(id, n, e.data);
              row.chunks = n + 1;
              await saveRecording(row);
            })
            .catch(() => {
              storageFailed = true;
              if (rec.state === "recording") rec.stop();
              if (mounted.current)
                setError(
                  "Device storage failed. Export any saved chunks before clearing browser data."
                );
            });
          if (row.byte_size > 100 * 1024 * 1024 && rec.state === "recording")
            rec.stop();
        };
        rec.onstop = () => {
          cleanup();
          const duration = Date.now() - startTime;
          void writes
            .then(async () => {
              row.duration_ms = duration;
              row.gps = gps.filter(p => p.video_ms <= duration);
              row.complete = !storageFailed;
              await saveRecording(row);
              if (mounted.current) {
                setRecording(false);
                await refresh();
                setNotice(
                  row.gps.length < 2
                    ? "Video saved locally. GPS coverage is insufficient for submission."
                    : "Video and GPS saved on this device. Export a backup or upload when ready."
                );
              }
            })
            .catch(e => {
              if (mounted.current) {
                setRecording(false);
                setError(e.message);
              }
            });
        };
        rec.onerror = () => {
          if (rec.state === "recording") rec.stop();
          cleanup();
          setError(
            "Camera recording failed. Check saved clips before retrying."
          );
        };
        startTime = Date.now();
        row.recorded_at = new Date(startTime).toISOString();
        rec.start(2000);
        setRecording(true);
        setSeconds(0);
        gpsWatch.current = navigator.geolocation.watchPosition(
          p => {
            const offset = p.timestamp - startTime;
            if (offset >= 0 && offset > (gps.at(-1)?.video_ms ?? -1)) {
              gps.push({
                timestamp: new Date(p.timestamp).toISOString(),
                video_ms: offset,
                latitude: p.coords.latitude,
                longitude: p.coords.longitude,
                accuracy_m: p.coords.accuracy,
              });
              setAccuracy(p.coords.accuracy);
            }
          },
          () => {
            if (rec.state === "recording") rec.stop();
            setError(
              "GPS access was interrupted. The clip was stopped and saved."
            );
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
        stopTimer.current = setTimeout(() => {
          if (rec.state === "recording") rec.stop();
        }, 120000);
        clock.current = setInterval(
          () => setSeconds(Math.floor((Date.now() - startTime) / 1000)),
          1000
        );
      } catch (e) {
        cleanup();
        throw e;
      }
    });
  }
  const manifest = (row: SavedRecording) => ({
    area_id: area,
    filename: row.filename,
    content_type: row.content_type,
    byte_size: row.byte_size,
    duration_ms: row.duration_ms,
    recorded_at: row.recorded_at,
    gps: row.gps,
    gps_offset_ms: row.gps_offset_ms,
    timing_source: row.timing_source,
    consent: true,
  });
  async function upload(row: SavedRecording) {
    await action(async () => {
      if (!signedIn || !area || !consent)
        throw new Error(
          "Sign in, select a locality and accept sharing before uploading."
        );
      if (!row.complete || row.gps.length < 2)
        throw new Error(
          "A complete recording with at least two GPS samples is required."
        );
      if (drive.trim()) {
        await contributorRequest("/evidence", "POST", {
          ...manifest(row),
          drive_url: drive.trim(),
        });
        setNotice(
          "Private Drive reference submitted. The owner must grant the project reviewers access."
        );
        return;
      }
      const blob = await recordingBlob(row);
      if (row.upload && row.upload.area_id !== area)
        throw new Error(
          "Resume this upload in its original locality: " + row.upload.area_id
        );
      if (!row.upload) {
        const created = await contributorRequest<{ id: string }>(
          "/evidence",
          "POST",
          manifest(row)
        );
        row.upload = { id: created.id, area_id: area, parts: [] };
        await saveRecording(row);
      }
      const size = 8 * 1024 * 1024,
        count = Math.ceil(blob.size / size);
      for (let number = 1; number <= count; number++) {
        if (row.upload.parts.some(p => p.part_number === number)) continue;
        setNotice("Uploading part " + number + " of " + count + "…");
        const part = await contributorRequest<{ url: string }>(
          "/evidence/" + row.upload.id + "/part",
          "POST",
          { part_number: number }
        );
        const response = await fetch(part.url, {
          method: "PUT",
          body: blob.slice((number - 1) * size, number * size),
          credentials: "omit",
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok)
          throw new Error(
            "Upload interrupted. Keep this clip and click Resume upload to retry."
          );
        const etag = response.headers.get("etag");
        if (!etag)
          throw new Error("Storage must expose ETag in its CORS settings.");
        row.upload.parts.push({ part_number: number, etag });
        await saveRecording(row);
      }
      await contributorRequest(
        "/evidence/" + row.upload.id + "/complete",
        "POST",
        { parts: row.upload.parts }
      );
      row.upload.complete = true;
      await saveRecording(row);
      setNotice(
        "Recording delivered to your locality’s review inbox. Your device copy is preserved."
      );
      await refresh();
    });
  }
  async function importPair(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await action(async () => {
      const file = f.get("video") as File,
        track = f.get("track") as File;
      if (file.size > 1024 * 1024 * 1024 || track.size > 1800000)
        throw new Error(
          "Maximum video size is 1 GB and GPS file size is 1.8 MB."
        );
      const data = JSON.parse(await track.text());
      if (
        !Array.isArray(data.gps) ||
        !data.recorded_at ||
        !Number.isFinite(data.duration_ms) ||
        data.duration_ms <= 0
      )
        throw new Error(
          "GPS manifest must contain gps[], recorded_at and duration_ms."
        );
      if (data.duration_ms > 120000)
        throw new Error("Private road-damage clips must be no longer than two minutes. Split the video and pair each clip with its GPS track.");
      const contentType =
        file.type ||
        (/\.mp4$/i.test(file.name)
          ? "video/mp4"
          : /\.mov$/i.test(file.name)
            ? "video/quicktime"
            : "video/webm");
      if (!["video/mp4", "video/webm", "video/quicktime"].includes(contentType))
        throw new Error("Select an MP4, WebM or MOV recording.");
      const id = crypto.randomUUID(),
        size = 8 * 1024 * 1024,
        row: SavedRecording = {
          id,
          filename: file.name,
          content_type: contentType as SavedRecording["content_type"],
          byte_size: file.size,
          duration_ms: data.duration_ms,
          recorded_at: data.recorded_at,
          gps: data.gps,
          gps_offset_ms: data.gps_offset_ms || 0,
          timing_source: "USER_SUPPLIED",
          chunks: 0,
          complete: false,
        };
      await saveRecording(row);
      for (let i = 0; i < Math.ceil(file.size / size); i++) {
        await saveChunk(id, i, file.slice(i * size, (i + 1) * size));
        row.chunks = i + 1;
        await saveRecording(row);
      }
      row.complete = true;
      await saveRecording(row);
      await refresh();
      setNotice(
        "Paired recording saved. The server will validate the GPS timeline on submission."
      );
    });
  }
  return (
    <div className="authority-shell">
      <div className="authority-workspace" style={{ marginLeft: 0 }}>
        <header className="authority-topbar">
          <Link href="/contribute/login">← Contributor account</Link>
          <span>Private recording workspace</span>
        </header>
        <main>
          <div className="authority-heading">
            <div>
              <p className="authority-kicker">YOUR DEVICE · YOUR CHOICE</p>
              <h1>Record the road. Keep the context.</h1>
              <p>
                Save a short road-facing video with a timestamped GPS track,
                then share it when you’re ready.
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="authority-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="authority-success">
              {notice}
            </p>
          )}
          <section className="authority-overview-grid">
            <article className="authority-card">
              <h2>Record a road observation</h2>
              <video
                ref={camera}
                muted
                playsInline
                className={recording ? "w-full rounded-lg bg-slate-900 my-5 aspect-video" : "hidden"}
              />
              {!recording && <div className="my-5 aspect-video rounded-lg bg-[#18372e] text-[#c7d9c9] flex flex-col items-center justify-center gap-3"><Camera size={32}/><span>Camera preview</span><small>Camera access starts only when you choose to record.</small></div>}
              <p className="authority-summary">
                {recording
                  ? "Recording · " + seconds + " seconds"
                  : "Up to 2 minutes per clip · audio off"}{" "}
                {accuracy !== null
                  ? " · GPS ±" + Math.round(accuracy) + " m"
                  : ""}
              </p>
              <label className="!flex items-start gap-3">
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                  disabled={recording}
                />
                I have permission to record this footage. I agree to save camera
                and GPS data on my device and, when I choose Upload, share it
                with the assigned road authorities for review.
              </label>
              <div className="authority-card-actions">
                <button
                  className="authority-primary"
                  disabled={busy || recording || !consent}
                  onClick={() => void start()}
                >
                  <Camera size={17} />
                  Start recording
                </button>
                <button
                  className="authority-secondary"
                  disabled={!recording}
                  onClick={() => recorder.current?.stop()}
                >
                  <Square size={16} />
                  Stop & save
                </button>
              </div>
              <p className="authority-footnote">
                Set up while parked or ask a passenger to operate. Keep this
                page visible. GPS accuracy depends on your device and
                surroundings; low-quality sections may remain unmapped. Browser
                storage can be cleared by the device, so export a backup.
              </p>
            </article>
            <article className="authority-card">
              <h2>Already have dashcam footage?</h2>
              <p className="authority-summary">
                Pair the video with a GPS JSON manifest from the same recording.
                A video without location data cannot be placed accurately on the
                map.
              </p>
              <form onSubmit={importPair}>
                <label>
                  Dashcam video
                  <input
                    required
                    name="video"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mov"
                  />
                </label>
                <label>
                  GPS manifest
                  <input required name="track" type="file" accept=".json" />
                </label>
                <button
                  disabled={busy || recording}
                  className="authority-secondary"
                >
                  <Download size={16} />
                  Save paired files on device
                </button>
              </form>
              <hr className="my-6 border-slate-200" />
              <h2>Choose where to submit</h2>
              {!signedIn ? (
                <p className="authority-summary">
                  <Link href="/contribute/login">
                    Sign in to upload your recordings.
                  </Link>{" "}
                  Local recording remains available.
                </p>
              ) : (
                <>
                  <label>
                    Operating locality
                    <select
                      value={area}
                      onChange={e => setArea(e.target.value)}
                    >
                      <option value="">Select locality</option>
                      {areas.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Private Drive link (optional)
                    <input
                      type="url"
                      placeholder="https://drive.google.com/file/d/…/view"
                      value={drive}
                      onChange={e => setDrive(e.target.value)}
                    />
                  </label>
                  <p className="authority-footnote">
                    Leave the link empty for direct private storage upload.
                    Drive references require the owner to grant reviewers access
                    separately.
                  </p>
                </>
              )}
            </article>
          </section>
          <article className="authority-card">
            <h2>Saved on this device</h2>
            {!rows.length && (
              <p className="authority-summary">No recordings saved yet.</p>
            )}
            {rows.map(row => (
              <div key={row.id} className="authority-update-row">
                <MapPin size={20} />
                <div>
                  <strong>{row.filename}</strong>
                  <small>
                    {(row.byte_size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {row.gps.length} GPS samples ·{" "}
                    {row.complete ? "Saved" : "Interrupted / partial"}
                  </small>
                </div>
                <button
                  className="authority-secondary"
                  disabled={busy || recording}
                  onClick={() =>
                    void action(async () =>
                      downloadBlob(await recordingBlob(row), row.filename)
                    )
                  }
                >
                  <Download size={15} />
                  Video
                </button>
                <button
                  className="authority-secondary"
                  onClick={() =>
                    downloadBlob(
                      new Blob([JSON.stringify(manifest(row), null, 2)], {
                        type: "application/json",
                      }),
                      row.filename + ".gps.json"
                    )
                  }
                >
                  GPS JSON
                </button>
                <button
                  className="authority-primary"
                  disabled={
                    busy ||
                    recording ||
                    !signedIn ||
                    !area ||
                    !consent ||
                    row.upload?.complete
                  }
                  onClick={() => void upload(row)}
                >
                  <Upload size={15} />
                  {row.upload?.complete
                    ? "Uploaded"
                    : row.upload
                      ? "Resume upload"
                      : "Upload"}
                </button>
                <button
                  aria-label={"Delete local copy of " + row.filename}
                  disabled={busy || recording}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this device copy? Export a backup first."
                      )
                    )
                      void action(async () => {
                        await deleteRecording(row);
                        await refresh();
                      });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </article>
        </main>
      </div>
    </div>
  );
}

