import React, { useState } from "react";
import { ImageOff } from "lucide-react";
import { C } from "../ui";

interface Props {
  src: string;
  alt: string;
  size?: number;
}

export default function PhotoThumb({ src, alt, size = 56 }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        onClick={() => src && setExpanded(true)}
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          cursor: src ? "zoom-in" : "default",
          border: `1px solid ${C.border}`,
        }}
      >
        {src ? (
          <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ImageOff size={Math.round(size * 0.35)} style={{ color: C.sub }} />
        )}
      </div>

      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
            cursor: "zoom-out",
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{ width: 400, height: 400, maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 12, background: "#fff" }}
          />
        </div>
      )}
    </>
  );
}
