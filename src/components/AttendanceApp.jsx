import React, { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import SelfieCamera from "./SelfieCamera";

/* -------------------- IST time helper -------------------- */
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

export default function AttendanceApp() {
  /* -------------------- camera -------------------- */
  const [cameraOpen, setCameraOpen] = useState(false);

  /* -------------------- flow state -------------------- */
  // null | "checkin" | "lunchStart" | "lunchEnd" | "checkout"
  const [lastAction, setLastAction] = useState(null);
  const [isTimeFrozen, setIsTimeFrozen] = useState(false);

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

  // selected action (radio)
  const [type, setType] = useState("checkin");

  /* -------------------- IST clock (freeze rules) -------------------- */
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  useEffect(() => {
    // if frozen, do not run realtime interval
    if (isTimeFrozen) return;

    const tick = () => {
      const { date, time } = istDateTimeParts(new Date());
      setDateStr(date);
      setTimeStr(time);
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isTimeFrozen]);

  /* -------------------- location -------------------- */
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [address, setAddress] = useState("");
  const [locErr, setLocErr] = useState("");

  const getLocation = () => {
    setLocErr("");

    if (!("geolocation" in navigator)) {
      setLocErr("Geolocation not supported");
      return;
    }

    const opts = {
      enableHighAccuracy: true,
      maximumAge: 0,
    };

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;

        setLat(la);
        setLng(ln);

        try {
          const a = await reverseGeocode(la, ln);
          setAddress(a);
        } catch {
          setAddress("");
        }
      },
      (err) => {
        if (err.code === 1)
          setLocErr("Location blocked. Please allow Location permission.");
        else if (err.code === 2)
          setLocErr("Location unavailable (turn on GPS).");
        else setLocErr(err.message || "Location error");
      },
      opts
    );
  };

  // Optional: keep updating lat/lng in background (good for accuracy)
  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // initial load: location + time snapshot
  useEffect(() => {
    getLocation();
    const { date, time } = istDateTimeParts(new Date());
    setDateStr(date);
    setTimeStr(time);
  }, []);

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

  // whenever allowedTypes changes, ensure selected radio stays valid
  useEffect(() => {
    if (!officeId || !employeeId) return;

    const first = allowedTypes[0] || "checkin";
    if (!allowedTypes.includes(type)) setType(first);
  }, [officeId, employeeId, allowedTypes, type]);

  /* -------------------- FULL PAGE REFRESH -------------------- */
  const onFullRefresh = () => {
    window.location.reload();
  };

  /* -------------------- submit -------------------- */
  const onSubmit = async () => {
    if (!officeId) return alert("Please select office");
    if (!employeeId) return alert("Please select employee");

    if (!allowedTypes.includes(type)) {
      return alert("This action is not allowed now. Follow the order.");
    }

    if (lat == null || lng == null) return alert("Location not available");
    if (!selfieFile) return alert("Please take selfie");

    const payload = {
      officeId,
      employeeId,
      type,
      date: dateStr,
      timeIST: timeStr,
      lat,
      lng,
      address,
      selfieFileName: selfieFile.name,
    };

    console.log("Attendance payload:", payload);
    alert(`Saved: ${type}`);

    setLastAction(type);
    setSelfieFile(null);
  };

  /* -------------------- UI -------------------- */
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img className="logoImg" src="/logo.jpeg" alt="Amrita Logo" />
          <div className="title">Amrita Global Enterprises</div>
        </div>

        <button
          type="button"
          className="iconBtn"
          onClick={onFullRefresh}
          title="Refresh"
        >
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
            onChange={(e) => {
              const val = e.target.value;

              setOfficeId(val);
              setEmployeeId("");
              setLastAction(null);
              setType("checkin");
              setSelfieFile(null);

              if (val) {
                const { date, time } = istDateTimeParts(new Date());
                setDateStr(date);
                setTimeStr(time);
                setIsTimeFrozen(true);
              } else {
                setIsTimeFrozen(false);
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

        {/* STEP 2: Employee (only after office) */}
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

        {/* STEP 3: Attendance Type (only after employee) */}
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
                  <label
                    key={opt.key}
                    className="radioItem"
                    style={{ opacity: enabled ? 1 : 0.35 }}
                  >
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

            {allowedTypes.length === 0 && (
              <div className="errorText">Attendance finished (Checkout done).</div>
            )}
          </div>
        )}

        {/* Date/Time/Location info */}
        <div className="card">
          <div className="infoLine">📅 Date: {dateStr}</div>
          <div className="infoLine">🕒 Time (IST): {timeStr}</div>

          {lat != null && lng != null && (
            <div className="infoLine">
              📍 Lat: {lat.toFixed(7)}, Lng: {lng.toFixed(7)}
            </div>
          )}

          {address && <div className="infoLine">📌 {address}</div>}
          {locErr && <div className="errorText">{locErr}</div>}
        </div>

        {/* Map */}
        <div className="card mapCard">
          <MapView lat={lat} lng={lng} />
        </div>

        {/* Selfie + Submit (only after employee + allowed action exists) */}
        {officeId && employeeId && allowedTypes.length > 0 && (
          <div className="card">
            <button
              className="btn purple"
              type="button"
              onClick={() => setCameraOpen(true)}
            >
              📷 Take Selfie
            </button>

            <SelfieCamera
              open={cameraOpen}
              onClose={() => setCameraOpen(false)}
              onCapture={(file) => setSelfieFile(file)}
            />

            <div className="previewBox">
              {selfiePreview ? (
                <img
                  className="previewImg"
                  src={selfiePreview}
                  alt="Selfie Preview"
                />
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
