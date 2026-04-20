export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function env() {
  const hfToken = requireEnv("HF_TOKEN");
  const namespace = requireEnv("TRIBE_NAMESPACE");
  const datasetName = process.env.TRIBE_DATASET || "tribe-jobs";
  const flavor = process.env.TRIBE_FLAVOR || "a10g-large";
  const timeoutSec = parseInt(process.env.TRIBE_JOB_TIMEOUT || "3600", 10);
  const scriptUrl =
    process.env.TRIBE_SCRIPT_URL ||
    "https://raw.githubusercontent.com/armaanparikh/tribev2/main/app/jobs/tribe_predict.py";
  return {
    hfToken,
    namespace,
    datasetName,
    datasetRepo: `${namespace}/${datasetName}`,
    flavor,
    timeoutSec,
    scriptUrl,
  };
}

export type AppEnv = ReturnType<typeof env>;
