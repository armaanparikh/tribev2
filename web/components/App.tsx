"use client";

import { useState } from "react";
import { Uploader } from "./Uploader";
import { Viewer } from "./Viewer";
import type { JobMeta } from "@/lib/meta";

export function App() {
  const [job, setJob] = useState<JobMeta | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #22262c",
          fontWeight: 600,
        }}
      >
        TRIBE · Brain Activity Viewer
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>
        {job?.status === "done" ? (
          <Viewer job={job} onReset={() => setJob(null)} />
        ) : (
          <Uploader job={job} onJob={setJob} />
        )}
      </main>
    </div>
  );
}
