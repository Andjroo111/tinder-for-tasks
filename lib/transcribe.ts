export async function transcribeAudio(audio: Blob | ArrayBuffer, filename = "audio.webm"): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const form = new FormData();
  const blob = audio instanceof Blob ? audio : new Blob([audio], { type: "audio/webm" });
  form.append("file", blob, filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  form.append("temperature", "0");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq transcription failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { text: string };
  return json.text.trim();
}
