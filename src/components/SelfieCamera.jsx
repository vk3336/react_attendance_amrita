import React, { useEffect, useRef, useState } from "react";

export default function SelfieCamera({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [facingMode, setFacingMode] = useState("user"); // "user" = front, "environment" = back
  const streamRef = useRef(null);

  const stopStream = () => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async (mode = facingMode) => {
    setError("");
    setLoading(true);

    try {
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not supported in this browser");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;

        // iOS needs playsInline + sometimes explicit play
        await video.play();
      }
    } catch (e) {
      setError(e?.message || "Unable to open camera");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    startCamera(facingMode);

    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFlip = async () => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    await startCamera(next);
  };

  const handleCapture = async () => {
    setError("");

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const w = video.videoWidth || 720;
    const h = video.videoHeight || 720;

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Capture failed");
          return;
        }

        // Convert blob to File (so you can upload easily)
        const file = new File([blob], `selfie-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });

        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  if (!open) return null;

  return (
    <div className="camOverlay">
      <div className="camModal">
        <div className="camHeader">
          <div className="camTitle">Take Selfie</div>
          <button className="camX" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="camBody">
          <div className="camBox">
            <video
              ref={videoRef}
              className="camVideo"
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          {loading && <div className="camHint">Opening camera…</div>}
          {error && <div className="camError">{error}</div>}
        </div>

        <div className="camFooter">
          <button className="btn" type="button" onClick={handleFlip}>
            🔄 Flip
          </button>

          <button className="btn green" type="button" onClick={handleCapture}>
            📸 Capture
          </button>
        </div>
      </div>
    </div>
  );
}
