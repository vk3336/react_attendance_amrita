import React from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";

export default function MapView({ lat, lng }) {
  const center = lat != null && lng != null ? [lat, lng] : [23.0225, 72.5714];

  return (
    <MapContainer
      center={center}
      zoom={15}
      scrollWheelZoom={false}
      style={{ height: 240, width: "100%", borderRadius: 14, overflow: "hidden" }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {lat != null && lng != null && <Marker position={[lat, lng]} />}
    </MapContainer>
  );
}
