import puppeteer, { Browser, Page } from 'puppeteer';

class ScreenRecorder {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private chunks: BlobPart[] = [];
  private videoPath: string = '';

  async startRecording(url: string): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-usermedia-screen-capturing',
        '--allow-http-screen-capture',
        '--auto-select-desktop-capture-source=Entire screen',
        '--disable-infobars',
        '--disable-features=TranslateUI'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.goto(url);

    this.videoPath = `recording_${Date.now()}.webm`;

    await this.page.exposeFunction('onDataAvailable', (data: BlobPart) => {
      this.chunks.push(data);
    });

    await this.page.evaluate(() => {
      const startRecording = () => {
        navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
          const mediaRecorder = new MediaRecorder(stream);
          (window as any).mediaRecorder = mediaRecorder; // Store mediaRecorder globally

          mediaRecorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) {
              (window as any).onDataAvailable(event.data);
            }
          };

          mediaRecorder.start();
        });
      };

      startRecording();
    });
  }

  async stopRecording(): Promise<string> {
    if (!this.page) {
      throw new Error('Recording not started');
    }

    await this.page.evaluate(() => {
      (window as any).mediaRecorder.stop(); 
    });

    await new Promise(resolve => setTimeout(resolve, 1000)); 

    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    const fs = require('fs');
    fs.writeFileSync(this.videoPath, Buffer.from(buffer));

    await this.browser?.close();

    return this.videoPath;
  }
}

export const recorder = new ScreenRecorder();
