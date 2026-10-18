// Saving what the simulation view shows: a video recording or a still image.

export interface VideoFormat { mime: string; ext: string; }

// MP4 where the browser can record it (it plays everywhere), otherwise WebM
export function pickVideoFormat(): VideoFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: VideoFormat[] = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ];
  return candidates.find(c => MediaRecorder.isTypeSupported(c.mime)) || null;
}

export const recordingSupported = (): boolean =>
  typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!pickVideoFormat();

export class SceneRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private format: VideoFormat | null = null;
  private stream: MediaStream | null = null;
  startedAt = 0;

  get recording() { return !!this.recorder && this.recorder.state !== 'inactive'; }

  // Throws when the browser cannot record
  start(canvas: HTMLCanvasElement, audio: MediaStream | null) {
    if (this.recording) return;
    const format = pickVideoFormat();
    if (!format) throw new Error('This browser cannot record video');
    const stream = canvas.captureStream(60);
    if (audio) audio.getAudioTracks().forEach(track => stream.addTrack(track));
    this.chunks = [];
    this.format = format;
    this.stream = stream;
    const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    recorder.start(500);
    this.recorder = recorder;
    this.startedAt = performance.now();
  }

  // Resolves with the finished file, or null if nothing was captured
  stop(): Promise<{ blob: Blob; ext: string } | null> {
    const recorder = this.recorder;
    const format = this.format;
    if (!recorder || !format || recorder.state === 'inactive') return Promise.resolve(null);
    return new Promise(resolve => {
      recorder.onstop = () => {
        // Only the canvas's own video tracks are stopped: the audio track belongs to the shared synthesiser
        if (this.stream) this.stream.getVideoTracks().forEach(track => track.stop());
        this.stream = null;
        this.recorder = null;
        const blob = new Blob(this.chunks, { type: format.mime.split(';')[0] });
        this.chunks = [];
        resolve(blob.size > 0 ? { blob, ext: format.ext } : null);
      };
      recorder.stop();
    });
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.${ext}`;
}
