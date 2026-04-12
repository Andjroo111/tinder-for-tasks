const MODE_PATH = `${import.meta.dir}/../data/mode.json`;

export type Mode = "live" | "test";

export async function getMode(): Promise<Mode> {
  const file = Bun.file(MODE_PATH);
  if (!(await file.exists())) return "test";
  try {
    const d = (await file.json()) as { mode?: Mode };
    return d.mode === "live" ? "live" : "test";
  } catch {
    return "test";
  }
}

export async function setMode(mode: Mode): Promise<void> {
  await Bun.write(MODE_PATH, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2));
}
