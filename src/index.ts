import express from "express";
import { launch, getStream } from "puppeteer-stream";
import { executablePath } from "puppeteer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const app = express();
const port = 3002;

interface RecordingSession {
  browser: any;
  page: any;
  recorder: fs.WriteStream;
  directoryName: string;
}

const activeSessions: Map<string, RecordingSession> = new Map();

app.use(express.json());

function dateToString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

const recordingsDir = path.join(__dirname, "..", "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

const sanitizeFilename = (name: string): string => name.replace(/[|&;$%@"<>()+, ]/g, "");

app.get("/start", async (req, res) => {
  const url = req.query.url as string;
  const doctor = sanitizeFilename(req.query.doctor as string);
  const patient = sanitizeFilename(req.query.patient as string);

  if (!url || !doctor || !patient) {
    return res.status(400).json({
      message: "Missing url, doctor, or patient query parameter",
    });
  }

  try {
    const browser = await launch({
      executablePath: executablePath(),
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
      args: [
        "--headless=new",
      ],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    const urlObj = new URL(url);

    const context = browser.defaultBrowserContext();
    await context.overridePermissions(urlObj.origin, ["microphone", "camera"]);
    const page = await browser.newPage();
    await page.goto(urlObj.href);

    const stream = await getStream(page, {
      audio: true,
      video: true,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 2500000,
    });

    const now = new Date();
    const timestamp = dateToString(now);
    const directoryName = `recording_${doctor}_${patient}_${timestamp}`;
    const outputPath = path.join(recordingsDir, directoryName);

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const fileName = `recording_${timestamp}`;
    const recorder = stream.pipe(
      fs.createWriteStream(path.join(outputPath, `${fileName}.webm`))
    );

    activeSessions.set(url, { browser, page, recorder, directoryName });

    console.log("Recording started. Directory name:", directoryName);

    res.json({ message: "Recording started", directoryName, fileName, url: urlObj.href });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({ error: "Failed to start recording", details: (error as Error).message });
  }
});

app.get("/stop", async (req, res) => {
  const url = req.query.url as string;
  
  if (!url) {
    return res.status(400).json({ error: "Missing url query parameter" });
  }

  console.log("Stop endpoint called for URL:", url);

  try {
    const session = activeSessions.get(url);
    if (!session) {
      return res.status(400).json({ error: "No active recording found for the given URL" });
    }

    const { browser, page, recorder, directoryName } = session;

    recorder.close();
    await page.close();
    await browser.close();

    const outputPath = path.join(recordingsDir, directoryName);
    const fileName = fs
      .readdirSync(outputPath)
      .find((file) => file.endsWith(".webm"))
      ?.replace(".webm", "");
    
    if (!fileName) {
      throw new Error("WebM file not found in the output directory");
    }

    const webmPath = path.join(outputPath, `${fileName}.webm`);
    const mp4Path = path.join(outputPath, `video.mp4`);
    const mp3Path = path.join(outputPath, `audio.mp3`);

    console.log("WebM file path:", webmPath);

    if (!fs.existsSync(webmPath)) {
      throw new Error(`WebM file not found: ${webmPath}`);
    }

    console.log(`Converting ${webmPath} to MP4 and MP3`);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(webmPath)                // Set the input WebM file to be converted
          .outputOptions('-c:v libx264')  // Use the H.264 video codec for MP4 output
          .outputOptions('-crf 28')       // Set the Constant Rate Factor (CRF) for video quality (higher CRF = lower quality)
          .outputOptions('-preset faster') // Set a faster preset for quicker encoding
          .outputOptions('-c:a aac')      // Use AAC audio codec for MP4 output
          .outputOptions('-b:a 64k')      // Set audio bitrate for MP4
          .outputOptions('-vf scale=640:-2') // Scale video to 640 pixels wide, maintain aspect ratio
          .output(mp4Path)                // Specify the output path for MP4 file
          .on("end", () => resolve())     // Resolve promise when conversion completes
          .on("error", (err) => reject(err)) // Reject promise on error
          .run();                         // Execute ffmpeg conversion
      }),
      new Promise<void>((resolve, reject) => {
        ffmpeg(webmPath)                 // Set the input WebM file to be converted
          .outputOptions('-vn')          // Disable video output
          .outputOptions('-c:a libmp3lame') // Use MP3 audio codec (libmp3lame) for MP3 output
          .outputOptions('-b:a 64k')     // Set audio bitrate for MP3
          .output(mp3Path)               // Specify the output path for MP3 file
          .on("end", () => resolve())    // Resolve promise when conversion completes
          .on("error", (err) => reject(err)) // Reject promise on error
          .run();                        // Execute ffmpeg conversion
      })
    ]);

    console.log("Conversion completed");

    fs.unlink(webmPath, (err) => {
      if (err) console.error("Failed to delete WebM file:", err);
    });

    activeSessions.delete(url);

    res.json({
      message: "Recording stopped, saved, and converted to MP4 and MP3",
    });
  } catch (error) {
    console.error("Error stopping recording or converting:", error);
    res.status(500).json({
      error: "Failed to stop recording or convert files",
      details: (error as Error).message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});