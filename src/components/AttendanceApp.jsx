import React, { useEffect, useMemo, useState } from "react";
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

/* -------------------- small helpers -------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const ACTION_LABELS = {
  checkin: "Checkin",
  checkout: "Checkout",
  lunchStart: "Lunch Start",
  lunchEnd: "Lunch End",
};

const COMPANY_NAME = "Amrita Global Enterprises";

/* -------------------- In-App Modal (No "localhost says") -------------------- */
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

export default function AttendanceApp() {
  /* -------------------- camera -------------------- */
  const [cameraOpen, setCameraOpen] = useState(false);

  /* -------------------- flow state -------------------- */
  const [lastAction, setLastAction] = useState(null);

  /* -------------------- freeze flags -------------------- */
  const [isTimeFrozen, setIsTimeFrozen] = useState(false);
  const [isLocationFrozen, setIsLocationFrozen] = useState(false);

  /* -------------------- sample data -------------------- */
  const offices = useMemo(
    () => [
      { id: "ahm", name: "Ahmedabad Office" },
      { id: "mum", name: "Mumbai Office" },
    ],
    []
  );

  const employees = useMemo(
    () => [
      { id: "e1", officeId: "ahm", name: "Rahul Patel" },
      { id: "e2", officeId: "ahm", name: "Kiran Shah" },
      { id: "e3", officeId: "mum", name: "Neha Mehta" },
    ],
    []
  );

  /* -------------------- selections -------------------- */
  const [officeId, setOfficeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("checkin");

  /* -------------------- App Modal state -------------------- */
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    refreshOnOk: false,
  });

  const openModal = (title, message, refreshOnOk = false) => {
    setModal({ open: true, title, message, refreshOnOk });
  };

  const closeModal = () => {
    setModal((m) => ({ ...m, open: false }));
  };

  /* -------------------- TRUSTED IST TIME (NO DEVICE FALLBACK) -------------------- */
  const [timeSync, setTimeSync] = useState({
    serverEpochMs: null,
    perfAtSync: null,
  });
  const [isTimeReady, setIsTimeReady] = useState(false);

  const getTrustedNow = () => {
    const { serverEpochMs, perfAtSync } = timeSync;
    if (serverEpochMs == null || perfAtSync == null) return null;
    const deltaMs = performance.now() - perfAtSync;
    return new Date(serverEpochMs + deltaMs);
  };

  const syncKolkataTime = async () => {
    setIsTimeReady(false);

    const providers = [
      async () => {
        const t0 = performance.now();
        const data = await fetchJsonWithTimeout(
          "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Kolkata",
          8000
        );
        const serverMs = new Date(data.dateTime).getTime();
        const rtt = performance.now() - t0;
        return serverMs + Math.floor(rtt / 2);
      },
      async () => {
        const t0 = performance.now();
        const data = await fetchJsonWithTimeout(
          "https://worldtimeapi.org/api/timezone/Asia/Kolkata",
          8000
        );
        const serverMs = new Date(data.datetime).getTime();
        const rtt = performance.now() - t0;
        return serverMs + Math.floor(rtt / 2);
      },
    ];

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const p of providers) {
        try {
          const compensatedServerMs = await p();
          if (!Number.isFinite(compensatedServerMs)) throw new Error("Invalid IST time");

          setTimeSync({
            serverEpochMs: compensatedServerMs,
            perfAtSync: performance.now(),
          });

          setIsTimeReady(true);
          console.log("[IST] Sync OK");
          return;
        } catch (e) {
          lastError = e;
          console.warn("[IST] Sync attempt failed:", e?.message || e);
        }
      }
      await sleep(400 * attempt);
    }

    console.error("[IST] Sync failed (all retries):", lastError?.message || lastError);
    setIsTimeReady(false);
  };

  /* -------------------- IST clock strings -------------------- */
  const [dateStr, setDateStr] = useState("--");
  const [timeStr, setTimeStr] = useState("--");

  useEffect(() => {
    if (isTimeFrozen) return;

    const tick = () => {
      const trusted = getTrustedNow();
      if (!trusted) {
        setDateStr("--");
        setTimeStr("--");
        return;
      }
      const { date, time } = istDateTimeParts(trusted);
      setDateStr(date);
      setTimeStr(time);
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimeFrozen, timeSync]);

  useEffect(() => {
    syncKolkataTime();
    const t = setInterval(syncKolkataTime, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- location (LIVE) -------------------- */
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [address, setAddress] = useState("");
  const [locErr, setLocErr] = useState("");

  /* -------------------- location (FROZEN) -------------------- */
  const [frozenLat, setFrozenLat] = useState(null);
  const [frozenLng, setFrozenLng] = useState(null);
  const [frozenAddress, setFrozenAddress] = useState("");

  const displayLat = isLocationFrozen ? frozenLat : lat;
  const displayLng = isLocationFrozen ? frozenLng : lng;
  const displayAddress = isLocationFrozen ? frozenAddress : address;

  const getLocation = () => {
    setLocErr("");

    if (!("geolocation" in navigator)) {
      setLocErr("Geolocation not supported");
      console.warn("[LOC] Geolocation not supported");
      return;
    }

    const opts = { enableHighAccuracy: true, maximumAge: 0 };

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;

        if (!isLocationFrozen) {
          setLat(la);
          setLng(ln);
        }

        try {
          const a = await reverseGeocode(la, ln);
          if (!isLocationFrozen) setAddress(a);
        } catch (e) {
          if (!isLocationFrozen) setAddress("");
          console.warn("[LOC] Reverse geocode failed:", e?.message || e);
        }
      },
      (err) => {
        if (err.code === 1) setLocErr("Location blocked. Please allow Location permission.");
        else if (err.code === 2) setLocErr("Location unavailable (turn on GPS).");
        else setLocErr(err.message || "Location error");

        console.warn("[LOC] Location error:", err);
      },
      opts
    );
  };

  useEffect(() => {
    getLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- freeze location helper -------------------- */
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
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    });
  };

  /* -------------------- selfie -------------------- */
  const [selfieFile, setSelfieFile] = useState(null);
  const selfiePreview = useMemo(() => {
    if (!selfieFile) return "";
    return URL.createObjectURL(selfieFile);
  }, [selfieFile]);

  /* -------------------- employee list by office -------------------- */
  const filteredEmployees = useMemo(() => {
    if (!officeId) return [];
    return employees.filter((e) => e.officeId === officeId);
  }, [officeId, employees]);

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

  /* -------------------- ✅ SOFT REFRESH (whole page reset, no reload) -------------------- */
  const onRefreshAll = async () => {
    console.log("[APP] Refresh");

    setCameraOpen(false);
    setOfficeId("");
    setEmployeeId("");
    setType("checkin");
    setLastAction(null);
    setSelfieFile(null);

    setIsTimeFrozen(false);
    setDateStr("--");
    setTimeStr("--");

    setIsLocationFrozen(false);
    setFrozenLat(null);
    setFrozenLng(null);
    setFrozenAddress("");

    setLat(null);
    setLng(null);
    setAddress("");
    setLocErr("");

    await syncKolkataTime();
    getLocation();
  };

  /* -------------------- submit -------------------- */
  const onSubmit = async () => {
    // validations (use in-app modal instead of alert)
    if (!officeId) return openModal(COMPANY_NAME, "Please select office.");
    if (!employeeId) return openModal(COMPANY_NAME, "Please select employee.");
    if (!allowedTypes.includes(type))
      return openModal(COMPANY_NAME, "This action is not allowed now. Follow the order.");
    if (!isTimeReady) return openModal(COMPANY_NAME, "Kolkata time is syncing. Wait 1–2 seconds.");
    if (displayLat == null || displayLng == null)
      return openModal(COMPANY_NAME, "Location not available.");
    if (!selfieFile) return openModal(COMPANY_NAME, "Please take selfie.");

    const payload = {
      officeId,
      employeeId,
      type,
      date: dateStr,
      timeIST: timeStr,
      lat: displayLat,
      lng: displayLng,
      address: displayAddress,
      selfieFileName: selfieFile.name,
    };

    console.log("Attendance payload:", payload);

    const actionLabel = ACTION_LABELS[type] || type;

    // ✅ success modal — OK triggers refresh
    openModal(
      COMPANY_NAME,
      `${COMPANY_NAME}: ${actionLabel} submitted ✅`,
      true
    );
  };

  const onModalOk = async () => {
    const shouldRefresh = modal.refreshOnOk;
    closeModal();
    if (shouldRefresh) await onRefreshAll();
  };

  return (
    <div className="page">
      {/* ✅ in-app modal */}
      <AppModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        okText="OK"
        onOk={onModalOk}
      />

      <header className="topbar">
        <div className="brand">
          <img className="logoImg" src="/logo.jpeg" alt="Amrita Logo" />
          <div className="title">{COMPANY_NAME}</div>
        </div>

        <button type="button" className="iconBtn" onClick={onRefreshAll} title="Refresh">
          ⟳
        </button>
      </header>

      <div className="container">
        {/* STEP 1: Office */}
        <div className="card">
          <label className="label">🏢 Select Office</label>
          <select
            className="input"
            value={officeId}
            onChange={async (e) => {
              const val = e.target.value;

              setOfficeId(val);
              setEmployeeId("");
              setLastAction(null);
              setType("checkin");
              setSelfieFile(null);

              if (val) {
                // ✅ Freeze time
                setIsTimeFrozen(true);
                const trusted = getTrustedNow();
                if (trusted) {
                  const { date, time } = istDateTimeParts(trusted);
                  setDateStr(date);
                  setTimeStr(time);
                } else {
                  setDateStr("--");
                  setTimeStr("--");
                }

                // ✅ Freeze location
                await freezeLocationNow();
              } else {
                // ✅ Unfreeze
                setIsTimeFrozen(false);
                setIsLocationFrozen(false);
                setFrozenLat(null);
                setFrozenLng(null);
                setFrozenAddress("");
              }
            }}
          >
            <option value="">Select Office</option>
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
              <option value="">Select Employee</option>
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
