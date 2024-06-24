import express from 'express';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const app = express();
const port = 3000;

let browser: Browser | null = null;
let page: Page | null = null;
let isRecording = false;
let ffmpegProcess: ChildProcessWithoutNullStreams | null = null;

const recordingsDir = path.join(__dirname, '../recordings');
const recordingPath = path.join(recordingsDir, 'recording.mp4');

if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
  console.log(`Created recordings directory at ${recordingsDir}`);
}

app.get('/start', async (req, res) => {
  if (isRecording) {
    return res.status(400).send('Perekaman sudah dimulai');
  }

  try {
    browser = await puppeteer.launch({
      args: ['--use-fake-ui-for-media-stream', '--allow-file-access-from-files']
    });
    page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('https://www.youtube.com/watch?v=eWrqOU0mdVc&ab_channel=Puranandastraiku');

    await page.waitForSelector('video');

    ffmpegProcess = spawn('ffmpeg', [
      '-f', 'gdigrab',
      '-framerate', '30',
      '-i', 'desktop',
      '-f', 'dshow',
      // '-i', 'audio="Microphone Array (Intel® Smart Sound Technology for Digital Microphones)"',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-y',  
      recordingPath
    ]);

    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      isRecording = false;
      ffmpegProcess = null;
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

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
    if (ffmpegProcess) {
      ffmpegProcess.stdin.write('q');
      ffmpegProcess.stdin.end();

      ffmpegProcess.on('close', () => {
        console.log('FFmpeg recording stopped.');
        res.send('Perekaman dihentikan dan file disimpan');
      });

      ffmpegProcess.on('error', (error) => {
        console.error('FFmpeg error:', error);
        res.status(500).send('Terjadi kesalahan saat menghentikan perekaman');
      });
    }

    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Terjadi kesalahan saat menghentikan perekaman');
  }
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
