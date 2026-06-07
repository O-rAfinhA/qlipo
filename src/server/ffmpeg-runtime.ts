import Ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

if (ffmpegPath) {
  Ffmpeg.setFfmpegPath(ffmpegPath);
}

export { Ffmpeg, ffmpegPath };
