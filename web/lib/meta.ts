export type JobStatus = "pending" | "running" | "done" | "error";

export interface JobMeta {
  id: string;
  status: JobStatus;
  message: string;
  videoName: string;
  videoExt: string;
  hfJobId?: string;
  hfStage?: string;
  hfMessage?: string;
  n_timesteps: number;
  duration: number;
  tr: number;
  hemo_lag: number;
  createdAt: string;
  updatedAt: string;
}

export function newMeta(id: string, videoName: string, videoExt: string): JobMeta {
  const now = new Date().toISOString();
  return {
    id,
    status: "pending",
    message: "Waiting for upload",
    videoName,
    videoExt,
    n_timesteps: 0,
    duration: 0,
    tr: 1,
    hemo_lag: 5,
    createdAt: now,
    updatedAt: now,
  };
}
