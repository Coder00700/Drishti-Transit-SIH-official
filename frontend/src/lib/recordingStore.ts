export type GPSPoint = {
  timestamp: string;
  video_ms: number;
  latitude: number;
  longitude: number;
  accuracy_m: number;
};
export type SavedRecording = {
  id: string;
  filename: string;
  content_type: "video/webm" | "video/mp4" | "video/quicktime";
  byte_size: number;
  duration_ms: number;
  recorded_at: string;
  gps: GPSPoint[];
  gps_offset_ms: number;
  timing_source: "DEVICE_CAPTURE" | "USER_SUPPLIED";
  chunks: number;
  complete: boolean;
  upload?: {
    id: string;
    area_id: string;
    complete?: boolean;
    parts: { part_number: number; etag: string }[];
  };
};
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("drishti-road-recordings", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings", { keyPath: "id" });
      request.result.createObjectStore("chunks");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = run(transaction.objectStore(name));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Device storage is full."));
    };
  });
}
export const saveRecording = (recording: SavedRecording) =>
  transact("recordings", "readwrite", s => s.put(recording));
export const listRecordings = () =>
  transact<SavedRecording[]>("recordings", "readonly", s => s.getAll());
export const saveChunk = (id: string, index: number, blob: Blob) =>
  transact("chunks", "readwrite", s =>
    s.put(blob, id + ":" + String(index).padStart(6, "0"))
  );
export async function recordingBlob(row: SavedRecording) {
  const chunks: Blob[] = [];
  for (let i = 0; i < row.chunks; i++) {
    const blob = await transact<Blob>("chunks", "readonly", s =>
      s.get(row.id + ":" + String(i).padStart(6, "0"))
    );
    if (!blob)
      throw new Error(
        "A saved video chunk is missing. Keep any exported backup."
      );
    chunks.push(blob);
  }
  return new Blob(chunks, { type: row.content_type });
}
export async function deleteRecording(row: SavedRecording) {
  for (let i = 0; i < row.chunks; i++)
    await transact("chunks", "readwrite", s =>
      s.delete(row.id + ":" + String(i).padStart(6, "0"))
    );
  await transact("recordings", "readwrite", s => s.delete(row.id));
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

