import express from "express";
import { launch, getStream } from "puppeteer-stream";
import { executablePath } from "puppeteer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
// import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
// ffmpeg.setFfmpegPath(ffmpegPath);


const app = express();
const port = 3002;

let browsers = new Map();
let pages = new Map();
let recorders = new Map();
let directoryNames = new Map();

app.use(express.json());

const recordingsDir = path.join(__dirname, "..", "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

app.get("/start", async (req, res) => {
  const url = req.query.url as string;
  const doctor = req.query.doctor as string;
  const patient = req.query.patient as string;

  if (!url || !doctor || !patient) {
    return res.status(400).json({
      message: "Missing url, doctor, or patient query parameter"
    });
  }

  try {
    const browser = await launch({
      executablePath: executablePath(),
      // headless: true,
      // executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      // or on linux: "google-chrome-stable"
      // or on mac: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--headless=new",
        // "--use-fake-ui-for-media-stream",
      ],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    const urlObj = new URL(url);
    console.log("URL:", urlObj);

    const context = browser.defaultBrowserContext();
    await context.overridePermissions(urlObj.origin, ["microphone", "camera"]);
    const page = await browser.newPage();
    await page.goto(urlObj.href);

    browsers.set(url, browser);
    pages.set(url, page);

    const stream = await getStream(page, {
      audio: true,
      video: true,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 2500000
    });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const directoryName = `recording_${doctor}_${patient}_${timestamp}`;
    const outputPath = path.join(recordingsDir, directoryName);

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const fileName = `recording_${timestamp}`;
    const writeStream = fs.createWriteStream(path.join(outputPath, `${fileName}.webm`));
    const recorder = stream.pipe(writeStream);

    directoryNames.set(url, directoryName);
    recorders.set(url, { recorder, writeStream });

    console.log("Recording started. Directory name: ", directoryName, " Key: ", url);

    res.json({ message: "Recording started", directoryName, fileName });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({ error: "Failed to start recording" });
  }
});

app.get("/stop", async (req, res) => {
  const key = req.query.url as string;
  const recorderInfo = recorders.get(key);
  const directoryName = directoryNames.get(key);
  const browser = browsers.get(key);
  const page = pages.get(key);

  console.log("Stop endpoint called. Recorder:", !!recorderInfo.recorder, "Directory name:", directoryName, "Key: ", key);

  try {
    if (recorderInfo && directoryName) {
      recorderInfo.writeStream.end();
      await page.close();
      await browser.close();

      const outputPath = path.join(recordingsDir, directoryName);
      const fileName = fs.readdirSync(outputPath).find(file => file.endsWith(".webm"))?.replace(".webm", "");
      const webmPath = path.join(outputPath, `${fileName}.webm`);
      const mp4Path = path.join(outputPath, `${fileName}.mp4`);
      const wavPath = path.join(outputPath, `${fileName}.mp3`);

      console.log("WebM file path:", webmPath);

      if (!fs.existsSync(webmPath)) {
        throw new Error(`WebM file not found: ${webmPath}`);
      }

      console.log(`Converting ${webmPath} to MP4 and WAV`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(webmPath)
          .outputOptions("-c:v copy")
          .outputOptions("-c:a aac")
          .output(mp4Path)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(webmPath)
          .outputOptions("-vn")
          .outputOptions("-c:a libmp3lame")
          .outputOptions("-q:a 2")
          .output(wavPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });

      console.log("Conversion completed");

      browsers.delete(key); // Remove from the map
      pages.delete(key); // Remove from the map
      recorders.delete(key); // Remove from the map
      directoryNames.delete(key); // Remove from the map
      fs.unlink(webmPath, () => {});  // Remove the input file after conversion

      res.json({ message: "Recording stopped, saved, and converted to MP4 and WAV" });
    } else {
      res.status(400).json({ error: "No active recording found or directoryName not set" });
    }
  } catch (error: any) {
    console.error("Error stopping recording or converting:", error);
    res.status(500).json({ error: `Failed to stop recording or convert files: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
