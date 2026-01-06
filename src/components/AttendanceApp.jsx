import React, { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import SelfieCamera from "./SelfieCamera";

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

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Reverse geocode failed");
  const data = await res.json();
  return data?.display_name || "";
}

export default function AttendanceApp() {
  // ✅ MUST be inside component
  const [cameraOpen, setCameraOpen] = useState(false);

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

  const [officeId, setOfficeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("checkin");

  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [address, setAddress] = useState("");
  const [locErr, setLocErr] = useState("");

  const [selfieFile, setSelfieFile] = useState(null);
  const selfiePreview = useMemo(() => {
    if (!selfieFile) return "";
    return URL.createObjectURL(selfieFile);
  }, [selfieFile]);

  const filteredEmployees = useMemo(() => {
    if (!officeId) return [];
    return employees.filter((e) => e.officeId === officeId);
  }, [officeId, employees]);

  useEffect(() => {
    const tick = () => {
      const { date, time } = istDateTimeParts(new Date());
      setDateStr(date);
      setTimeStr(time);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const getLocation = () => {
  setLocErr("");

  if (!("geolocation" in navigator)) {
    setLocErr("Geolocation not supported");
    return;
  }

  const opts = {
    enableHighAccuracy: true,
    timeout: 20000,
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
      // Better error messages
      if (err.code === 1) setLocErr("Location permission denied");
      else if (err.code === 2) setLocErr("Location unavailable (turn on GPS)");
      else if (err.code === 3) setLocErr("Timeout: move outside / try again");
      else setLocErr(err.message || "Location error");
    },
    opts
  );
};

useEffect(() => {
  if (!("geolocation" in navigator)) return;

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      setLat(pos.coords.latitude);
      setLng(pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );

  return () => navigator.geolocation.clearWatch(watchId);
}, []);


  useEffect(() => {
    getLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async () => {
    if (!officeId) return alert("Please select office");
    if (!employeeId) return alert("Please select employee");
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
    alert("Attendance captured (check console). Now connect API.");
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img className="logoImg" src="/logo.jpeg" alt="Amrita Logo" />
          <div className="title">Amrita Global Enterprises</div>
        </div>

        <button className="iconBtn" onClick={getLocation} title="Refresh">
          ⟳
        </button>
      </header>

      <div className="container">
        <div className="card">
          <label className="label">🏢 Select Office</label>
          <select
            className="input"
            value={officeId}
            onChange={(e) => {
              setOfficeId(e.target.value);
              setEmployeeId("");
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

        <div className="card">
          <label className="label">👤 Select Employee</label>
          <select
            className="input"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            disabled={!officeId}
          >
            <option value="">
              {officeId ? "Select Employee" : "Select Office first"}
            </option>
            {filteredEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <label className="label">❗ Attendance Type</label>

          <div className="radioRow">
            <label className="radioItem">
              <input
                type="radio"
                name="type"
                checked={type === "checkin"}
                onChange={() => setType("checkin")}
              />
              <span>Checkin</span>
            </label>

            <label className="radioItem">
              <input
                type="radio"
                name="type"
                checked={type === "checkout"}
                onChange={() => setType("checkout")}
              />
              <span>Checkout</span>
            </label>

            <label className="radioItem">
              <input
                type="radio"
                name="type"
                checked={type === "lunchStart"}
                onChange={() => setType("lunchStart")}
              />
              <span>Lunch Start</span>
            </label>

            <label className="radioItem">
              <input
                type="radio"
                name="type"
                checked={type === "lunchEnd"}
                onChange={() => setType("lunchEnd")}
              />
              <span>Lunch End</span>
            </label>
          </div>
        </div>

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

        <div className="card mapCard">
          <MapView lat={lat} lng={lng} />
        </div>

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
              <img className="previewImg" src={selfiePreview} alt="Selfie Preview" />
            ) : (
              <div className="placeholder">Selfie Preview</div>
            )}
          </div>

          <button className="btn green" onClick={onSubmit}>
            ✅ Submit Attendance
          </button>
        </div>
      </div>
    </div>
  );
}
