import ffmpeg from "fluent-ffmpeg";

export function convertToMp4(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input)
      .outputOptions("-c:v libx264")
      .outputOptions("-crf 28")
      .outputOptions("-preset faster")
      .outputOptions("-c:a aac")
      .outputOptions("-b:a 64k")
      .outputOptions("-vf scale=640:-2")
      .output(output)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
