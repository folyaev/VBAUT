import { app, DEFAULT_PORT, getServerRuntimeInfo } from "./index.js";

app.listen(DEFAULT_PORT, () => {
  console.log(`Backend listening on http://localhost:${DEFAULT_PORT}`);
  const runtime = getServerRuntimeInfo();
  const tools = runtime.tools;
  console.log(`Media downloader: yt-dlp=${tools.yt_dlp_path || "N/A"} ffmpeg_location=${tools.ffmpeg_location || "N/A"}`);
  console.log(`Media root: ${runtime.mediaRoot}`);
});
