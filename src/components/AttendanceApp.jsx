import React, { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import SelfieCamera from "./SelfieCamera";

/* -------------------- IST formatter (format only) -------------------- */
function istDateTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/* -------------------- reverse geocode -------------------- */
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Reverse geocode failed");
  const data = await res.json();
  return data?.display_name || "";
}

/* -------------------- fetch json with timeout -------------------- */
async function fetchJsonWithTimeout(url, ms = 8000, headers = {}, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...headers, ...(init.headers || {}) },
      cache: "no-store",
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} @ ${url}${text ? ` — ${text}` : ""}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();

    const txt = await res.text().catch(() => "");
    return txt ? JSON.parse(txt) : {};
  } finally {
    clearTimeout(t);
  }
}

// ✅ fast server time: read "Date" header from ESPO response
async function fetchDateHeaderMsWithTimeout(url, ms = 8000, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    const dateHeader = res.headers.get("date");
    if (!dateHeader) throw new Error("Missing Date header");
    const msVal = new Date(dateHeader).getTime();
    if (!Number.isFinite(msVal)) throw new Error("Invalid Date header");
    return msVal;
  } finally {
    clearTimeout(t);
  }
}

/* -------------------- FAST time cache helpers -------------------- */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function readCachedTimeSync() {
  try {
    const raw = localStorage.getItem("TIME_SYNC_CACHE_V1");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Number.isFinite(obj.serverEpochMs) || !Number.isFinite(obj.savedAtMs)) return null;
    return obj;
  } catch {
    return null;
  }
}

function writeCachedTimeSync(serverEpochMs) {
  try {
    localStorage.setItem(
      "TIME_SYNC_CACHE_V1",
      JSON.stringify({ serverEpochMs, savedAtMs: Date.now() })
    );
  } catch {}
}

const ACTION_LABELS = {
  checkin: "Checkin",
  checkout: "Checkout",
  lunchStart: "Lunch Start",
  lunchEnd: "Lunch End",
};

const COMPANY_NAME = "Amrita Global Enterprises";

/* -------------------- In-App Modal (No browser alert) -------------------- */
function AppModal({ open, title, message, okText = "OK", onOk }) {
  if (!open) return null;

  return (
    <div style={styles.modalOverlay} role="dialog" aria-modal="true">
      <div style={styles.modalBox}>
        <div style={styles.modalTitle}>{title}</div>
        <div style={styles.modalMsg}>{message}</div>
        <div style={styles.modalActions}>
          <button type="button" style={styles.modalOkBtn} onClick={onOk}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- file -> dataURL(base64) -------------------- */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export default function AttendanceApp() {
  /* -------------------- camera -------------------- */
  const [cameraOpen, setCameraOpen] = useState(false);

  /* -------------------- flow state -------------------- */
  const [lastAction, setLastAction] = useState(null);

  /* -------------------- freeze flags -------------------- */
  const [isTimeFrozen, setIsTimeFrozen] = useState(false);
  const [isLocationFrozen, setIsLocationFrozen] = useState(false);

  /* -------------------- ✅ ESPO env -------------------- */
  const ESPO_BASEURL = (import.meta.env.VITE_ESPO_BASEURL || "").trim(); // .../api/v1/CAttendance
  const ESPO_API_KEY = (import.meta.env.VITE_X_API_KEY || "").trim();

  const espoHeaders = useMemo(() => ({ "X-Api-Key": ESPO_API_KEY }), [ESPO_API_KEY]);

  const ESPO_API_ROOT = useMemo(() => {
    try {
      if (!ESPO_BASEURL) return "";
      const u = new URL(ESPO_BASEURL);
      u.search = "";
      u.hash = "";
      u.pathname = u.pathname.replace(/\/[^/]+\/?$/, "");
      return u.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }, [ESPO_BASEURL]);

  const ESPO_ATTACHMENT_URL = useMemo(() => {
    if (!ESPO_API_ROOT) return "";
    return `${ESPO_API_ROOT}/Attachment`;
  }, [ESPO_API_ROOT]);

  // ✅ must be the SAME as your old working upload field name
  const ESPO_UPLOAD_FIELD = "selfieImage";

  /* -------------------- type meta (matches your actual fields) -------------------- */
  const TYPE_META = {
    checkin: { timeField: "checkInAt", idField: "checkInSelfieId", nameField: "checkInSelfieName" },
    checkout: { timeField: "checkOutAt", idField: "checkOutSelfieId", nameField: "checkOutSelfieName" },
    lunchStart: { timeField: "lunchOutAt", idField: "lunchOutSelfieId", nameField: "lunchOutSelfieName" },
    lunchEnd: { timeField: "lunchInAt", idField: "lunchInSelfieId", nameField: "lunchInSelfieName" },
  };

  const normalizeKey = (s) => String(s || "").trim().toLowerCase();

  const buildEspoQueryUrl = (base, paramsObj) => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(paramsObj || {})) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  };

  /* -------------------- ✅ ESPO: find today's record -------------------- */
  const findTodayRecord = async ({ employeeName, attendanceDate }) => {
    if (!ESPO_BASEURL) throw new Error("VITE_ESPO_BASEURL missing");
    if (!ESPO_API_KEY) throw new Error("VITE_X_API_KEY missing");

    const u = new URL(ESPO_BASEURL);
    u.searchParams.set("maxSize", "1");
    u.searchParams.set("offset", "0");
    u.searchParams.set("orderBy", "createdAt");
    u.searchParams.set("order", "desc");

    u.searchParams.set("where[0][type]", "equals");
    u.searchParams.set("where[0][attribute]", "employeeName");
    u.searchParams.set("where[0][value]", employeeName);

    u.searchParams.set("where[1][type]", "equals");
    u.searchParams.set("where[1][attribute]", "attendanceDate");
    u.searchParams.set("where[1][value]", attendanceDate);

    const data = await fetchJsonWithTimeout(u.toString(), 12000, espoHeaders);
    const list = Array.isArray(data?.list) ? data.list : [];
    return list[0] || null;
  };

  /* -------------------- ✅ ESPO: upload selfie (hybrid approach) -------------------- */
  const espoUploadSelfie = async (file, fieldName) => {
    const dataUrl = await fileToDataUrl(file);
    
    // Try the attachment endpoint first
    try {
      if (ESPO_ATTACHMENT_URL) {
        const payload = {
          name: file.name || "selfie.jpg",
          type: file.type || "image/jpeg",
          role: "Attachment",
          relatedType: "CAttendance",
          field: fieldName, // Use the specific field name for this attendance type
          file: dataUrl,
        };

        const res = await fetchJsonWithTimeout(
          ESPO_ATTACHMENT_URL,
          20000,
          { ...espoHeaders, "Content-Type": "application/json" },
          { method: "POST", body: JSON.stringify(payload) }
        );

        const id = String(res?.id || "").trim();
        const name = String(res?.name || payload.name || "").trim();
        
        if (id) {
          // Attachment upload succeeded
          return { 
            id, 
            name, 
            dataUrl,
            useAttachment: true 
          };
        }
      }
    } catch (e) {
      console.warn("Attachment upload failed, using fallback:", e.message);
    }
    
    // Fallback: return base64 data only
    return {
      id: `selfie_${Date.now()}`,
      name: file.name || "selfie.jpg",
      dataUrl: dataUrl,
      useAttachment: false
    };
  };

  /* -------------------- ✅ ESPO: create / update -------------------- */
  const espoCreate = async (payload) => {
    return await fetchJsonWithTimeout(
      ESPO_BASEURL,
      20000,
      { ...espoHeaders, "Content-Type": "application/json" },
      { method: "POST", body: JSON.stringify(payload) }
    );
  };

  const espoUpdate = async (id, payload) => {
    const url = `${ESPO_BASEURL.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
    return await fetchJsonWithTimeout(
      url,
      20000,
      { ...espoHeaders, "Content-Type": "application/json" },
      { method: "PUT", body: JSON.stringify(payload) }
    );
  };

  const computeLastActionFromRecord = (rec) => {
    if (!rec) return null;
    if (rec?.checkOutAt) return "checkout";
    if (rec?.lunchInAt) return "lunchEnd";
    if (rec?.lunchOutAt) return "lunchStart";
    if (rec?.checkInAt) return "checkin";
    return null;
  };

  /* -------------------- ✅ offices + employees from ESPO -------------------- */
  const [offices, setOffices] = useState([]);
  const [employeesByOffice, setEmployeesByOffice] = useState({});
  const [orgLoading, setOrgLoading] = useState(true);

  const loadOrgFromEspo = async () => {
    try {
      setOrgLoading(true);

      if (!ESPO_BASEURL || !ESPO_API_KEY) {
        setOffices([]);
        setEmployeesByOffice({});
        return;
      }

      const url = buildEspoQueryUrl(ESPO_BASEURL, { maxSize: 200, offset: 0 });
      const data = await fetchJsonWithTimeout(url, 12000, espoHeaders);
      const list = Array.isArray(data?.list) ? data.list : [];

      const officeSeen = new Set();
      const officeArr = [];

      const empMap = {};
      const getBucket = (officeCode) => {
        if (!empMap[officeCode]) empMap[officeCode] = { seen: new Set(), arr: [] };
        return empMap[officeCode];
      };

      for (const row of list) {
        const officeCode = String(row?.officeCode || "").trim();
        const employeeName = String(row?.employeeName || "").trim();

        if (officeCode && !officeSeen.has(normalizeKey(officeCode))) {
          officeSeen.add(normalizeKey(officeCode));
          officeArr.push({ id: officeCode, name: officeCode });
        }

        if (officeCode && employeeName) {
          const b = getBucket(officeCode);
          const key = normalizeKey(employeeName);
          if (!b.seen.has(key)) {
            b.seen.add(key);
            b.arr.push({ id: employeeName, name: employeeName });
          }
        }
      }

      const finalEmployeesByOffice = {};
      for (const [officeCode, b] of Object.entries(empMap)) {
        finalEmployeesByOffice[officeCode] = b.arr;
      }

      setOffices(officeArr);
      setEmployeesByOffice(finalEmployeesByOffice);
    } catch (e) {
      console.warn("[ESPO] org fetch failed:", e?.message || e);
      setOffices([]);
      setEmployeesByOffice({});
    } finally {
      setOrgLoading(false);
    }
  };

  useEffect(() => {
    loadOrgFromEspo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- selections -------------------- */
  const [officeId, setOfficeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("checkin");

  /* -------------------- App Modal state -------------------- */
  const [modal, setModal] = useState({ open: false, title: "", message: "", refreshOnOk: false });
  const openModal = (title, message, refreshOnOk = false) =>
    setModal({ open: true, title, message, refreshOnOk });
  const closeModal = () => setModal((m) => ({ ...m, open: false }));

  /* -------------------- FAST IST TIME -------------------- */
  const [timeSync, setTimeSync] = useState({
    serverEpochMs: null,
    perfAtSync: null,
    isAuthoritative: false,
  });
  const [isTimeReady, setIsTimeReady] = useState(false);

  const [dateStr, setDateStr] = useState("--");
  const [timeStr, setTimeStr] = useState("--");

  const getTrustedNow = () => {
    const { serverEpochMs, perfAtSync } = timeSync;
    if (serverEpochMs == null || perfAtSync == null) return null;
    const deltaMs = performance.now() - perfAtSync;
    return new Date(serverEpochMs + deltaMs);
  };

  const renderClock = (d) => {
    const { date, time } = istDateTimeParts(d);
    setDateStr(date);
    setTimeStr(time);
  };

  const syncKolkataTimeFast = async () => {
    const providers = [
      async () => {
        if (!ESPO_BASEURL || !ESPO_API_KEY) throw new Error("ESPO not configured");
        const u = new URL(ESPO_BASEURL);
        u.searchParams.set("maxSize", "1");
        u.searchParams.set("offset", "0");
        const t0 = performance.now();
        const serverMs = await fetchDateHeaderMsWithTimeout(u.toString(), 5000, espoHeaders);
        const rtt = performance.now() - t0;
        return serverMs + Math.floor(rtt / 2);
      },
      async () => {
        const t0 = performance.now();
        const data = await fetchJsonWithTimeout(
          "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Kolkata",
          5000
        );
        const serverMs = new Date(data.dateTime).getTime();
        const rtt = performance.now() - t0;
        return serverMs + Math.floor(rtt / 2);
      },
      async () => {
        const t0 = performance.now();
        const data = await fetchJsonWithTimeout(
          "https://worldtimeapi.org/api/timezone/Asia/Kolkata",
          5000
        );
        const serverMs = new Date(data.datetime).getTime();
        const rtt = performance.now() - t0;
        return serverMs + Math.floor(rtt / 2);
      },
    ];

    let lastErr = null;

    for (const p of providers) {
      try {
        const ms = await p();
        if (!Number.isFinite(ms)) throw new Error("Invalid server time");

        setTimeSync({
          serverEpochMs: ms,
          perfAtSync: performance.now(),
          isAuthoritative: true,
        });
        setIsTimeReady(true);
        writeCachedTimeSync(ms);
        return;
      } catch (e) {
        lastErr = e;
      }
    }

    console.warn("[IST] sync failed:", lastErr?.message || lastErr);
  };

  useEffect(() => {
    renderClock(new Date());
    setIsTimeReady(true);

    const cached = readCachedTimeSync();
    if (cached) {
      const elapsed = Date.now() - cached.savedAtMs;
      const corrected = cached.serverEpochMs + clamp(elapsed, 0, 24 * 60 * 60 * 1000);
      setTimeSync({
        serverEpochMs: corrected,
        perfAtSync: performance.now(),
        isAuthoritative: false,
      });
    }

    syncKolkataTimeFast();
    const t = setInterval(syncKolkataTimeFast, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTimeFrozen) return;

    const tick = () => {
      const trusted = getTrustedNow();
      if (trusted) renderClock(trusted);
      else renderClock(new Date());
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isTimeFrozen, timeSync]);

  /* -------------------- location -------------------- */
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [address, setAddress] = useState("");
  const [locErr, setLocErr] = useState("");
  const lastGeoReqRef = useRef(0);

  const [frozenLat, setFrozenLat] = useState(null);
  const [frozenLng, setFrozenLng] = useState(null);
  const [frozenAddress, setFrozenAddress] = useState("");

  const displayLat = isLocationFrozen ? frozenLat : lat;
  const displayLng = isLocationFrozen ? frozenLng : lng;
  const displayAddress = isLocationFrozen ? frozenAddress : address;

  useEffect(() => {
    setLocErr("");

    if (!("geolocation" in navigator)) {
      setLocErr("Geolocation not supported");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;

        if (!isLocationFrozen) {
          setLat(la);
          setLng(ln);
        }

        const reqId = Date.now();
        lastGeoReqRef.current = reqId;

        try {
          const a = await reverseGeocode(la, ln);
          if (lastGeoReqRef.current !== reqId) return;
          if (!isLocationFrozen) setAddress(a);
        } catch {
          if (lastGeoReqRef.current !== reqId) return;
          if (!isLocationFrozen) setAddress("");
        }
      },
      (err) => {
        if (err.code === 1) setLocErr("Location blocked. Please allow Location permission.");
        else if (err.code === 2) setLocErr("Location unavailable (turn on GPS).");
        else setLocErr(err.message || "Location error");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [isLocationFrozen]);

  const freezeLocationNow = async () => {
    setIsLocationFrozen(true);

    if (lat != null && lng != null) {
      setFrozenLat(lat);
      setFrozenLng(lng);
      setFrozenAddress(address || "");
      return;
    }

    await new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve();

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const la = pos.coords.latitude;
          const ln = pos.coords.longitude;

          setFrozenLat(la);
          setFrozenLng(ln);

          try {
            const a = await reverseGeocode(la, ln);
            setFrozenAddress(a);
          } catch {
            setFrozenAddress("");
          }
          resolve();
        },
        () => resolve(),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    });
  };

  /* -------------------- selfie -------------------- */
  const [selfieFile, setSelfieFile] = useState(null);
  const selfiePreview = useMemo(() => (selfieFile ? URL.createObjectURL(selfieFile) : ""), [selfieFile]);

  useEffect(() => {
    return () => {
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    };
  }, [selfiePreview]);

  /* -------------------- employees list by office -------------------- */
  const filteredEmployees = useMemo(() => {
    if (!officeId) return [];
    return Array.isArray(employeesByOffice?.[officeId]) ? employeesByOffice[officeId] : [];
  }, [officeId, employeesByOffice]);

  /* -------------------- pull today's state -------------------- */
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!officeId || !employeeId) {
        setLastAction(null);
        return;
      }
      if (dateStr === "--") return;

      try {
        const rec = await findTodayRecord({ employeeName: employeeId, attendanceDate: dateStr });
        if (cancelled) return;
        setLastAction(computeLastActionFromRecord(rec));
      } catch {
        if (cancelled) return;
        setLastAction(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, employeeId, dateStr]);

  /* -------------------- allowed actions rules -------------------- */
  const allowedTypes = useMemo(() => {
    if (!officeId || !employeeId) return [];
    if (lastAction === null) return ["checkin"];
    if (lastAction === "checkin") return ["lunchStart", "checkout"];
    if (lastAction === "lunchStart") return ["lunchEnd", "checkout"];
    if (lastAction === "lunchEnd") return ["checkout"];
    return [];
  }, [officeId, employeeId, lastAction]);

  useEffect(() => {
    if (!officeId || !employeeId) return;
    const first = allowedTypes[0] || "checkin";
    if (!allowedTypes.includes(type)) setType(first);
  }, [officeId, employeeId, allowedTypes, type]);

  /* -------------------- refresh all -------------------- */
  const onRefreshAll = async () => {
    setCameraOpen(false);
    setOfficeId("");
    setEmployeeId("");
    setType("checkin");
    setLastAction(null);
    setSelfieFile(null);

    setIsTimeFrozen(false);
    renderClock(new Date());
    syncKolkataTimeFast();

    setIsLocationFrozen(false);
    setFrozenLat(null);
    setFrozenLng(null);
    setFrozenAddress("");

    setLat(null);
    setLng(null);
    setAddress("");
    setLocErr("");

    await loadOrgFromEspo();
  };

  /* -------------------- submit -------------------- */
  const onSubmit = async () => {
    if (!ESPO_BASEURL) return openModal(COMPANY_NAME, "ESPO base URL missing in .env");
    if (!ESPO_API_KEY) return openModal(COMPANY_NAME, "ESPO API key missing in .env");

    if (!officeId) return openModal(COMPANY_NAME, "Please select office.");
    if (!employeeId) return openModal(COMPANY_NAME, "Please select employee.");
    if (!allowedTypes.includes(type)) return openModal(COMPANY_NAME, "This action is not allowed now.");
    if (!isTimeReady) return openModal(COMPANY_NAME, "Time is initializing. Try again.");
    if (!selfieFile) return openModal(COMPANY_NAME, "Please take selfie.");

    const meta = TYPE_META[type];
    if (!meta) return openModal(COMPANY_NAME, "Invalid attendance type.");

    const date = dateStr;
    const dt = `${dateStr} ${timeStr}`;

    try {
      // 0) Upload selfie (hybrid approach) - use field name without 'Id' suffix
      const fieldName = meta.idField.replace('Id', '');
      const uploaded = await espoUploadSelfie(selfieFile, fieldName);
      console.log("Upload result:", uploaded);
      console.log("Using field name:", fieldName);

      // 1) Find existing record
      const existing = await findTodayRecord({ employeeName: employeeId, attendanceDate: date });

      // Handle location not available case
      if (displayLat == null || displayLng == null) {
        console.warn("Location not available, using default coordinates for testing");
        const defaultLat = 23.0240815;
        const defaultLng = 72.4720621;
        
        const basePayload = {
          name: employeeId,
          officeCode: officeId,
          employeeName: employeeId,
          attendanceDate: date,
          officeLat: Number(defaultLat),
          officeLng: Number(defaultLng),
          daykey: `${date}__${employeeId}`.toLowerCase(),
          notes: "Location not available - using default coordinates",

          // ✅ store image data - use attachment fields if available, fallback to custom fields
          ...(uploaded.useAttachment ? {
            [meta.idField]: uploaded.id,
            [meta.nameField]: uploaded.name,
          } : {}),
          // Always store base64 as backup
          [`${type}SelfieData`]: uploaded.dataUrl,
          [`${type}SelfieName`]: uploaded.name,
        };

        console.log("Base payload (with default location):", basePayload);
        console.log("Meta fields:", meta);

        if (!existing) {
          if (type !== "checkin") {
            return openModal(COMPANY_NAME, "First do Checkin for today, then Lunch/Checkout.");
          }

          const createPayload = {
            ...basePayload,
            [meta.timeField]: dt,
            recordType: "Attendance",
          };

          const created = await espoCreate(createPayload);
          setLastAction(computeLastActionFromRecord(created) || "checkin");

          setSelfieFile(null);
          openModal(COMPANY_NAME, `${COMPANY_NAME}: ${ACTION_LABELS[type]} submitted ✅`, true);
          return;
        }

        if (existing?.[meta.timeField]) {
          return openModal(COMPANY_NAME, `${ACTION_LABELS[type]} already done for today.`);
        }

        const updatePayload = {
          ...basePayload,
          [meta.timeField]: dt,
        };

        await espoUpdate(existing.id, updatePayload);

        const fresh = await findTodayRecord({ employeeName: employeeId, attendanceDate: date });
        setLastAction(computeLastActionFromRecord(fresh));

        setSelfieFile(null);
        openModal(COMPANY_NAME, `${COMPANY_NAME}: ${ACTION_LABELS[type]} submitted ✅`, true);
        return;
      }

      const basePayload = {
        name: employeeId,
        officeCode: officeId,
        employeeName: employeeId,
        attendanceDate: date,
        officeLat: Number(displayLat),
        officeLng: Number(displayLng),
        daykey: `${date}__${employeeId}`.toLowerCase(),
        notes: displayAddress || "",

        // ✅ store image data - use attachment fields if available, fallback to custom fields
        ...(uploaded.useAttachment ? {
          [meta.idField]: uploaded.id,
          [meta.nameField]: uploaded.name,
        } : {}),
        // Always store base64 as backup
        [`${type}SelfieData`]: uploaded.dataUrl,
        [`${type}SelfieName`]: uploaded.name,
      };

      console.log("Base payload:", basePayload);
      console.log("Meta fields:", meta);

      if (!existing) {
        if (type !== "checkin") {
          return openModal(COMPANY_NAME, "First do Checkin for today, then Lunch/Checkout.");
        }

        const createPayload = {
          ...basePayload,
          [meta.timeField]: dt,
          recordType: "Attendance",
        };

        const created = await espoCreate(createPayload);
        setLastAction(computeLastActionFromRecord(created) || "checkin");

        setSelfieFile(null);
        openModal(COMPANY_NAME, `${COMPANY_NAME}: ${ACTION_LABELS[type]} submitted ✅`, true);
        return;
      }

      if (existing?.[meta.timeField]) {
        return openModal(COMPANY_NAME, `${ACTION_LABELS[type]} already done for today.`);
      }

      const updatePayload = {
        ...basePayload,
        [meta.timeField]: dt,
      };

      await espoUpdate(existing.id, updatePayload);

      const fresh = await findTodayRecord({ employeeName: employeeId, attendanceDate: date });
      setLastAction(computeLastActionFromRecord(fresh));

      setSelfieFile(null);
      openModal(COMPANY_NAME, `${COMPANY_NAME}: ${ACTION_LABELS[type]} submitted ✅`, true);
    } catch (e) {
      console.warn("[ESPO] submit failed:", e?.message || e);
      openModal(COMPANY_NAME, `Submit failed.\n${e?.message || "Unknown error"}`);
    }
  };

  const onModalOk = async () => {
    const shouldRefresh = modal.refreshOnOk;
    closeModal();
    if (shouldRefresh) await onRefreshAll();
  };

  const cameraTitle = `Take Selfie (${ACTION_LABELS[type] || "Selfie"})`;
  const fileNamePrefix = `selfie-${type}`;

  return (
    <div className="page">
      <AppModal open={modal.open} title={modal.title} message={modal.message} okText="OK" onOk={onModalOk} />

      <header className="topbar">
        <div className="brand">
          <img className="logoImg" src="/logo.jpeg" alt="Amrita Logo" />
          <div className="title">{COMPANY_NAME}</div>
        </div>

        <button type="button" className="iconBtn" onClick={onRefreshAll} title="Refresh">
          ⟳
        </button>
        <button type="button" className="iconBtn" onClick={() => setLastAction(null)} title="Reset Attendance (Test Only)" style={{marginLeft: '10px', background: '#ff6b6b'}}>
          🔄
        </button>
      </header>

      <div className="container">
        {/* STEP 1: Office */}
        <div className="card">
          <label className="label">🏢 Select Office</label>
          <select
            className="input"
            value={officeId}
            disabled={orgLoading}
            onChange={async (e) => {
              const val = e.target.value;

              setOfficeId(val);
              setEmployeeId("");
              setLastAction(null);
              setType("checkin");
              setSelfieFile(null);

              if (val) {
                setIsTimeFrozen(true);

                const trusted = getTrustedNow();
                if (trusted) {
                  const { date, time } = istDateTimeParts(trusted);
                  setDateStr(date);
                  setTimeStr(time);
                } else {
                  const { date, time } = istDateTimeParts(new Date());
                  setDateStr(date);
                  setTimeStr(time);
                }

                await freezeLocationNow();
              } else {
                setIsTimeFrozen(false);

                setIsLocationFrozen(false);
                setFrozenLat(null);
                setFrozenLng(null);
                setFrozenAddress("");
              }
            }}
          >
            <option value="">
              {orgLoading ? "Loading offices..." : offices.length ? "Select Office" : "No offices found"}
            </option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        {/* STEP 2: Employee */}
        {officeId && (
          <div className="card">
            <label className="label">👤 Select Employee</label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => {
                const val = e.target.value;
                setEmployeeId(val);
                setLastAction(null);
                setType("checkin");
                setSelfieFile(null);
              }}
            >
              <option value="">{filteredEmployees.length ? "Select Employee" : "No employees found"}</option>
              {filteredEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* STEP 3: Attendance Type */}
        {officeId && employeeId && (
          <div className="card">
            <label className="label">❗ Attendance Type</label>

            <div className="radioRow">
              {[
                { key: "checkin", label: "Checkin" },
                { key: "checkout", label: "Checkout" },
                { key: "lunchStart", label: "Lunch Start" },
                { key: "lunchEnd", label: "Lunch End" },
              ].map((opt) => {
                const enabled = allowedTypes.includes(opt.key);
                return (
                  <label key={opt.key} className="radioItem" style={{ opacity: enabled ? 1 : 0.35 }}>
                    <input
                      type="radio"
                      name="type"
                      checked={type === opt.key}
                      disabled={!enabled}
                      onChange={() => setType(opt.key)}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Date/Time/Location */}
        <div className="card">
          <div className="infoLine">📅 Date: {dateStr}</div>
          <div className="infoLine">🕒 Time (IST - standard): {timeStr}</div>

          {displayLat != null && displayLng != null && (
            <div className="infoLine">
              📍 Lat: {displayLat.toFixed(7)}, Lng: {displayLng.toFixed(7)}
            </div>
          )}

          {displayAddress && <div className="infoLine">📌 {displayAddress}</div>}
          {locErr && <div className="errorText">{locErr}</div>}
        </div>

        {/* Map */}
        <div className="card mapCard">
          <MapView lat={displayLat} lng={displayLng} />
        </div>

        {/* Debug info - remove this later */}
       

        {/* Selfie + Submit */}
        {officeId && employeeId && allowedTypes.length > 0 && (
          <div className="card">
            <button className="btn purple" type="button" onClick={() => setCameraOpen(true)}>
              📷 Take Selfie
            </button>

            <SelfieCamera
              open={cameraOpen}
              onClose={() => setCameraOpen(false)}
              onCapture={(file) => setSelfieFile(file)}
              title={cameraTitle}
              fileNamePrefix={fileNamePrefix}
            />

            <div className="previewBox">
              {selfiePreview ? (
                <img className="previewImg" src={selfiePreview} alt="Selfie Preview" />
              ) : (
                <div className="placeholder">Selfie Preview</div>
              )}
            </div>

            <button className="btn green" onClick={onSubmit}>
              ✅ Submit Attendance
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------- inline modal styles -------------------- */
const styles = {
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  },
  modalBox: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 800,
    marginBottom: 10,
  },
  modalMsg: {
    fontSize: 14,
    lineHeight: 1.4,
    color: "#111",
    marginBottom: 14,
    whiteSpace: "pre-wrap",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalOkBtn: {
    border: "none",
    borderRadius: 12,
    padding: "10px 16px",
    fontWeight: 700,
    cursor: "pointer",
    background: "#111827",
    color: "#fff",
  },
};
