import ffmpeg from "fluent-ffmpeg";

export function convertToMp3(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .outputOptions("-vn")
        .outputOptions("-c:a libmp3lame")
        .outputOptions("-b:a 64k")
        .output(output)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  }