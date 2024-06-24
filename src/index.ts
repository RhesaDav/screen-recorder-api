import express from 'express';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';

const app = express();
const port = 3000;

let browser: Browser | null = null;
let page: Page | null = null;
let isRecording = false;
const recordingPath = path.join(__dirname, '../recording.webm');

app.get('/start', async (req, res) => {
  if (isRecording) {
    return res.status(400).send('Perekaman sudah dimulai');
  }

  try {
    browser = await puppeteer.launch();
    page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('https://www.youtube.com/watch?v=eWrqOU0mdVc&ab_channel=Puranandastraiku');

    await page.screencast({ path: recordingPath as `${string}.webm` });
    isRecording = true;

    res.send('Perekaman dimulai');
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Terjadi kesalahan saat memulai perekaman');
  }
});

app.get('/stop', async (req, res) => {
  if (!isRecording) {
    return res.status(400).send('Tidak ada perekaman yang sedang berlangsung');
  }

  try {
    if (page) {
      await page.screencast({ path: '' as `${string}.webm` });
    }

    if (browser) {
      await browser.close();
    }

    isRecording = false;
    browser = null;
    page = null;

    await new Promise(resolve => setTimeout(resolve, 1000));

    res.download(recordingPath, 'screen_recording.webm', (err) => {
      if (err) {
        console.error('Error saat mengunduh:', err);
        res.status(500).send('Terjadi kesalahan saat mengunduh file');
      } else {
        fs.unlinkSync(recordingPath);
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Terjadi kesalahan saat menghentikan perekaman');
  }
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});