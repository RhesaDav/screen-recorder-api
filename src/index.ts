import express from "express";
import puppeteer from "puppeteer";
import { launch, getStream } from "puppeteer-stream";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const app = express();
const port = 3000;

let browser: any;
let page: any;
let recorder: any;
let ffmpegProcess: any = null;
let fileName: string = "";

app.use(express.json());

const recordingsDir = path.join(__dirname, "..", "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

app.post("/start", async (req, res) => {
  try {
    browser = await launch({
      headless: true,
      // args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream']
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      // or on linux: "google-chrome-stable"
      // or on mac: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
      args: [
      //   "--no-sandbox",
      //   "--disable-setuid-sandbox",
        "--use-fake-ui-for-media-stream",
      ],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    const urlObj = new URL(
      "https://www.youtube.com/watch?v=eMCphn3x-x4&ab_channel=Tiogra"
    );

    const context = browser.defaultBrowserContext()
await context.overridePermissions(urlObj.origin, ['camera', 'microphone'])
    page = await browser.newPage();
    await page.goto(
      urlObj.href
    );

    const stream = await getStream(page, {
      audio: true,
      video: true,
      videoBitsPerSecond: 2500000,
    });

    const fileName = `recording_${Date.now()}`;
    const outputPath = path.join(recordingsDir, fileName);

    recorder = stream.pipe(fs.createWriteStream(`${outputPath}.webm`));

    res.json({ message: "Recording started", fileName });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({ error: "Failed to start recording" });
  }
});

app.post("/stop", async (req, res) => {
  try {
    if (recorder) {
      recorder.close();
      await page.close();
      await browser.close();

      res.json({ message: "Recording stopped and saved" });
    } else {
      res.status(400).json({ error: "No active recording found" });
    }
  } catch (error) {
    console.error("Error stopping recording:", error);
    res.status(500).json({ error: "Failed to stop recording" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
