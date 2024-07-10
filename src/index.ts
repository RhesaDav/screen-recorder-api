import express from "express";
import { launch, getStream } from "puppeteer-stream";
import { executablePath } from "puppeteer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import {
  dateToString,
  sanitizeFilename,
  convertToMp3,
  convertToMp4,
} from "./utils";
import { connectDB, pool, s3Client } from "./config";

dotenv.config();

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

connectDB()
app.use(express.json());

async function uploadToS3(filePath: string, directoryName: string) {
  if (!s3Client) {
    throw new Error("S3 client is not initialized. Cannot upload file.");
  }

  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const s3Key = `vcall-recording/${directoryName}/${fileName}`;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: "vcall-storage",
        Key: s3Key,
        Body: fileContent,
        ACL: "public-read",
      })
    );
    console.log(`File uploaded successfully to S3: ${s3Key}`);
    return `https://s3.ap-southeast-1.amazonaws.com/vcall-storage/${s3Key}`;
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    throw error;
  }
}

const recordingsDir = path.join(__dirname, "..", "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

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
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--headless=new"],
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

    res.json({
      message: "Recording started",
      directoryName,
      fileName,
      url: urlObj.href,
    });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({
      error: "Failed to start recording",
      details: (error as Error).message,
    });
  }
});

app.get("/stop", async (req, res) => {
  const url = req.query.url as string;
  const roomId = req.query.roomId as string;

  if (!url || !roomId) {
    return res.status(400).json({ error: "Missing url query parameter" });
  }

  console.log("Stop endpoint called for URL:", url);

  try {
    const session = activeSessions.get(url);
    if (!session) {
      return res
        .status(400)
        .json({ error: "No active recording found for the given URL" });
    }

    const { browser, page, recorder, directoryName } = session;

    recorder.close();
    await page.close();
    await browser.close();

    activeSessions.delete(url);

    res.json({
      message: "Recording stopped. Converting and uploading in progress.",
      status: "processing",
    });

    processRecording(directoryName, roomId).catch((error) => {
      console.error("Error processing recording:", error);
    });
  } catch (error) {
    console.error("Error stopping recording:", error);
    res.status(500).json({
      error: "Failed to stop recording",
      details: (error as Error).message,
    });
  }
});

async function processRecording(directoryName: string, roomId: string) {
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
    convertToMp4(webmPath, mp4Path),
    convertToMp3(webmPath, mp3Path),
  ]);

  console.log("Conversion completed");

  let mp4Url, mp3Url;
  try {
    mp4Url = await uploadToS3(mp4Path, directoryName);
    mp3Url = await uploadToS3(mp3Path, directoryName);

    const recordingResult = await saveRecordingInfo(mp3Url, mp4Url, roomId);

    fs.unlinkSync(webmPath);
    fs.unlinkSync(mp4Path);
    fs.unlinkSync(mp3Path);
  } catch (uploadError) {
    console.error("Error uploading files to S3:", uploadError);
    mp4Url = `local://${mp4Path}`;
    mp3Url = `local://${mp3Path}`;
  }

  fs.rm(outputPath, { recursive: true, force: true }, (err) => {
    if (err) console.error("Failed to delete recording directory:", err);
  });

  console.log("Recording processed successfully:", { mp4Url, mp3Url });
}

async function saveRecordingInfo(
  mp3Url: string,
  mp4Url: string,
  roomId: string
) {
  try {
    const fetchSave = await fetch(
      `${process.env.SYNERGIX_API_URL}/vcall/record`,
      {
        method: "POST",
        headers: {
          "app-key": process.env.SYNERGIX_API_KEY as string,
        },
        body: JSON.stringify({
          room: roomId,
          url: mp4Url,
        }),
      }
    );
    const checkRoom = await pool.query('SELECT "CALL" WHERE roomId = $1 ',[roomId])
    await pool.query(
      'UPDATE "Call" SET "mp3Url" = $1, "mp4Url" = $2 WHERE roomId = $3',
      [mp3Url, mp4Url, roomId]
    );
    console.log("Recording info saved to database");
  } catch (error) {
    console.error("Error saving recording info to database:", error);
  }
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
