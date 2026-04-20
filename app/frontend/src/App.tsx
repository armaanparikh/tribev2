import { useState } from "react";
import { Uploader } from "./Uploader";
import { Viewer } from "./Viewer";

export type JobStatus = {
  id: string;
  status: "pending" | "running" | "done" | "error";
  message: string;
  n_timesteps: number;
  duration: number;
  tr: number;
  hemo_lag: number;
  video_name: string;
};

export function App() {
  const [job, setJob] = useState<JobStatus | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ padding: "12px 20px", borderBottom: "1px solid #22262c", fontWeight: 600 }}>
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
