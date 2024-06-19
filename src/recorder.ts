import puppeteer from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

export const startRecording = async (url: string) => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);

  const recorder = new PuppeteerScreenRecorder(page);
  await recorder.start('./recording.mp4');

  setTimeout(async () => {
    await recorder.stop();
    await browser.close();
  }, 60000); 
};
