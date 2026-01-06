import React, { useMemo } from "react";

export default function MapView({ lat, lng }) {
  const src = useMemo(() => {
    const la = lat ?? 23.0225;
    const ln = lng ?? 72.5714;
    return `https://www.google.com/maps?q=${la},${ln}&z=16&output=embed`;
  }, [lat, lng]);

  return (
    <iframe
      title="Google Map"
      src={src}
      width="100%"
      height="240"
      style={{ border: 0, borderRadius: 14 }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}
