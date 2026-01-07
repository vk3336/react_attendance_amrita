import React, { useEffect, useMemo, useRef, useState } from "react";

// distance in meters between 2 coords
function distanceMeters(a, b) {
  if (!a || !b) return Infinity;

  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function MapView({ lat, lng }) {
  // ✅ last stable coordinate used by the iframe
  const [stable, setStable] = useState({ lat: 23.0225, lng: 72.5714 });

  // ✅ used to retry iframe load if stuck/blank
  const [reloadKey, setReloadKey] = useState(0);

  // ✅ loading fallback (because sometimes iframe stays blank)
  const [loading, setLoading] = useState(true);
  const loadTimerRef = useRef(null);

  // Only update iframe coords if moved > X meters (prevents jitter reload)
  const MOVE_THRESHOLD_METERS = 30;

  useEffect(() => {
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const next = { lat, lng };
    const moved = distanceMeters(stable, next);

    // update only if big movement OR first real GPS after default
    if (moved >= MOVE_THRESHOLD_METERS) {
      setStable(next);
    } else {
      // still keep stable unchanged to avoid iframe reload
      // but you still show latest lat/lng elsewhere in UI
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const src = useMemo(() => {
    const la = stable.lat ?? 23.0225;
    const ln = stable.lng ?? 72.5714;
    return `https://www.google.com/maps?q=${la},${ln}&z=16&output=embed`;
  }, [stable]);

  // Start a timer: if iframe doesn’t load in 6s, auto retry once
  useEffect(() => {
    setLoading(true);

    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);

    loadTimerRef.current = setTimeout(() => {
      // if still loading, retry by forcing iframe remount
      setReloadKey((k) => k + 1);
    }, 6000);

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [src]);

  const openInGoogleMaps = () => {
    const la = stable.lat ?? 23.0225;
    const ln = stable.lng ?? 72.5714;
    window.open(`https://www.google.com/maps?q=${la},${ln}`, "_blank");
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 14,
            background: "rgba(255,255,255,0.85)",
            border: "1px solid #e5e5e5",
            fontSize: 14,
          }}
        >
          Loading map…
        </div>
      )}

      <iframe
        key={reloadKey} // ✅ forces iframe to fully reload when needed
        title="Google Map"
        src={src}
        width="100%"
        height="240"
        style={{ border: 0, borderRadius: 14 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        onLoad={() => setLoading(false)}
      />

      {/* Optional: tiny controls */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Reload Map
        </button>

        <button
          type="button"
          onClick={openInGoogleMaps}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Open in Google Maps
        </button>
      </div>
    </div>
  );
}
