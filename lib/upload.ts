export type UploadTarget = { url: string; key: string };

export async function putFile(target: UploadTarget, file: Blob): Promise<string> {
  const response = await fetch(target.url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with HTTP ${response.status}`);
  }
  return target.key;
}
