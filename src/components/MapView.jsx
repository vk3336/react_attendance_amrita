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
  const DEFAULT = { lat: 23.0225, lng: 72.5714 };

  // last stable coordinate used by the iframe
  const [stable, setStable] = useState(DEFAULT);

  // force iframe reload when stable changes meaningfully
  const [reloadKey, setReloadKey] = useState(0);

  // loading fallback
  const [loading, setLoading] = useState(true);
  const loadTimerRef = useRef(null);

  // tweak this if you want smoother updates
  const MOVE_THRESHOLD_METERS = 15;

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const next = { lat, lng };

    setStable((prev) => {
      const moved = distanceMeters(prev, next);

      // Always accept first real coord (prev may be DEFAULT)
      const isDefault = prev.lat === DEFAULT.lat && prev.lng === DEFAULT.lng;

      if (isDefault || moved >= MOVE_THRESHOLD_METERS) {
        // also force iframe reload so it centers correctly
        setReloadKey((k) => k + 1);
        return next;
      }
      return prev;
    });
  }, [lat, lng]);

  // Better embed URL (more consistent centering than www.google.com/maps?q=)
  const src = useMemo(() => {
    const la = Number.isFinite(stable.lat) ? stable.lat : DEFAULT.lat;
    const ln = Number.isFinite(stable.lng) ? stable.lng : DEFAULT.lng;

    // `maps.google.com` embed behaves more predictably
    return `https://maps.google.com/maps?hl=en&z=17&t=m&output=embed&q=${la},${ln}`;
  }, [stable.lat, stable.lng]);

  // if iframe doesn’t load in 6s, retry once
  useEffect(() => {
    setLoading(true);

    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);

    loadTimerRef.current = setTimeout(() => {
      setReloadKey((k) => k + 1);
    }, 6000);

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [src]);

  const openInGoogleMaps = () => {
    const la = Number.isFinite(stable.lat) ? stable.lat : DEFAULT.lat;
    const ln = Number.isFinite(stable.lng) ? stable.lng : DEFAULT.lng;
    window.open(`https://www.google.com/maps?q=${la},${ln}`, "_blank", "noopener,noreferrer");
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
        key={reloadKey}
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
