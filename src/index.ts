import express from "express";
import { launch, getStream } from "puppeteer-stream";
import { executablePath } from "puppeteer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv"

dotenv.config()

const app = express();
const port = 3000;

let browser: any;
let page: any;
let recorder: any;
let directoryName: string = "";

app.use(express.json());

const s3Client = new S3Client({
  region: "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY || "",
    secretAccessKey: process.env.AWS_SECRET_KEY || "",
  },
});

const bucketName = "vcall-storage";
const folderName = "vcall-recording";

async function uploadToS3(filePath: string, fileName: string): Promise<string> {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: bucketName,
    Key: `${folderName}/${fileName}`,
    Body: fileContent,
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    const s3Url = `https://${bucketName}.s3.amazonaws.com/${folderName}/${fileName}`;
    console.log(`File uploaded successfully. ${s3Url}`);
    return s3Url;
  } catch (err) {
    console.error("Error uploading file:", err);
    throw err;
  }
}

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
      message: "Missing url, doctor, or patient query parameter",
    });
  }

  try {
    browser = await launch({
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
        // "--no-sandbox"
        //   "--disable-setuid-sandbox",
        "--headless=new",
        // "--use-fake-ui-for-media-stream",
      ],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    const urlObj = new URL(url);
    console.log("URL:", urlObj);

    const context = browser.defaultBrowserContext();
    await context.overridePermissions(urlObj.origin, ["microphone", "camera"]);
    page = await browser.newPage();
    await page.goto(urlObj.href);

    const stream = await getStream(page, {
      audio: true,
      video: true,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 2500000,
    });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    directoryName = `recording_${doctor}_${patient}_${timestamp}`;
    const outputPath = path.join(recordingsDir, directoryName);

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const fileName = `recording_${timestamp}`;
    recorder = stream.pipe(
      fs.createWriteStream(path.join(outputPath, `${fileName}.webm`))
    );

    console.log("Recording started. Directory name:", directoryName);

    res.json({ message: "Recording started", directoryName, fileName });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({ error: "Failed to start recording" });
  }
});

app.post("/stop", async (req, res) => {
  console.log(
    "Stop endpoint called. Recorder:",
    !!recorder,
    "Directory name:",
    directoryName
  );

  try {
    if (recorder && directoryName) {
      recorder.close();
      await page.close();
      await browser.close();

      const outputPath = path.join(recordingsDir, directoryName);
      const fileName = fs
        .readdirSync(outputPath)
        .find((file) => file.endsWith(".webm"))
        ?.replace(".webm", "");
      const webmPath = path.join(outputPath, `${fileName}.webm`);
      const mp4Path = path.join(outputPath, `${fileName}.mp4`);
      const wavPath = path.join(outputPath, `${fileName}.wav`);

      console.log("WebM file path:", webmPath);

      if (!fs.existsSync(webmPath)) {
        throw new Error(`WebM file not found: ${webmPath}`);
      }

      console.log(`Converting ${webmPath} to MP4 and WAV`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(webmPath)
          .outputOptions("-c:v libx264")
          .outputOptions("-crf 23")
          .outputOptions("-c:a aac")
          .outputOptions("-b:a 128k")
          .output(mp4Path)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(webmPath)
          .outputOptions("-acodec pcm_s16le")
          .outputOptions("-ac 2")
          .output(wavPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });

      console.log("Conversion completed");

      const mp4FileName = `${fileName}.mp4`;
      const mp4S3Url = await uploadToS3(mp4Path, mp4FileName);

      const wavFileName = `${fileName}.wav`;
      const wavS3Url = await uploadToS3(wavPath, wavFileName);

      recorder = null;
      directoryName = "";

      res.json({
        message: "Recording stopped, saved, and converted to MP4 and WAV",
        mp4Url: mp4S3Url,
        wavUrl: wavS3Url,
      });
    } else {
      res
        .status(400)
        .json({ error: "No active recording found or directoryName not set" });
    }
  } catch (error: any) {
    console.error("Error stopping recording or converting:", error);
    res
      .status(500)
      .json({
        error: `Failed to stop recording or convert files: ${error.message}`,
      });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
