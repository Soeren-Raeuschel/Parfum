"use client";
import React, { useRef, useState } from "react";
import { IconUpload } from "@tabler/icons-react";
import { useDropzone } from "react-dropzone";

export const FileUpload = ({ onChange }) => {
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (newFiles) => {
    const selectedFile = newFiles[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    onChange?.([selectedFile]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "text/tab-separated-values": [".tsv"],
      "text/plain": [".txt"],
      "text/csv": [".csv"],
    },
    multiple: false,
    noClick: true,
    onDrop: handleFileChange,
  });

  return (
    <div
      {...getRootProps()}
      style={{
        border: `1px dashed ${isDragActive ? "#534AB7" : "#D3D1C7"}`,
        borderRadius: 8,
        background: isDragActive ? "#F4F3FD" : "#FAFAF8",
        transition: "border-color .15s, background .15s",
      }}
    >
      <input {...getInputProps()} ref={fileInputRef} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "14px 48px",
          border: 0,
          background: "transparent",
          color: "#1A1A18",
          cursor: "pointer",
          textAlign: "center",
          fontFamily: "'Georgia', serif",
          position: "relative",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            transform: "translateY(-2px)",
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: 7,
              background: isDragActive ? "#534AB7" : "#F1EFE8",
              color: isDragActive ? "#fff" : "#534AB7",
            }}
          >
            <IconUpload size={16} stroke={1.6} />
          </span>
          <span style={{ minWidth: 0, maxWidth: "calc(100% - 46px)" }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>
            {isDragActive ? "Datei hier ablegen" : "TSV-Datei auswählen"}
          </span>
          <span style={{ display: "block", marginTop: 3, color: "#888780", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file ? file.name : "Ziehen oder klicken · maximal 2 MB"}
          </span>
          </span>
        </span>
        <span style={{ position: "absolute", right: 16, color: "#B4B2A9", fontSize: 18, lineHeight: 1 }}>›</span>
      </button>
    </div>
  );
};
