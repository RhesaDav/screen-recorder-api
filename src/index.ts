import express, { Request, Response, NextFunction } from "express";
import { PuppeteerScreenRecorder } from "puppeteer-screen-recorder";
import puppeteer, { Browser, Page } from "puppeteer";
import ErrorHandler from "./middlewares/errorHandler";
import { RecordScreenRequest } from "./types";

const app = express();
app.use(express.json());

let browser: Browser | null = null;
let page: Page | null = null;
let recorder: PuppeteerScreenRecorder | null = null;

function generateFileName(): string {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, "0");
  const day = String(currentDate.getDate()).padStart(2, "0");
  const hours = String(currentDate.getHours()).padStart(2, "0");
  const minutes = String(currentDate.getMinutes()).padStart(2, "0");
  const seconds = String(currentDate.getSeconds()).padStart(2, "0");

  const fileName = `doctor_pasien_${year}${month}${day}_${hours}${minutes}${seconds}`;
  return fileName;
}

app.post(
  "/record-screen",
  async (
    req: Request<{}, {}, RecordScreenRequest>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          message: 'Missing url parameter',
        });
      }
  
      browser = await puppeteer.launch();
      page = await browser.newPage();
      recorder = new PuppeteerScreenRecorder(page);
      await recorder.start(`./output/${generateFileName()}/video.mp4`);
      await page.goto(url);
      res.status(200).json({
        success: true,
        message: "Recording started",
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/stop-record",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (recorder && browser) {
        await recorder.stop();
        await browser.close();
        browser = null;
        page = null;
        recorder = null;
        res.status(200).json({
          success: true,
          message: "Recording stopped successfully",
        });
      } else {
        res.status(400).json({
          success: false,
          message: "No active recording found",
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

app.use(ErrorHandler);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server started on port http://localhost:${PORT}`);
});
