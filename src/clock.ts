// Playback clock. When a voice-over is loaded the audio element is the master clock.
import { useEffect, useState } from "react";

type L = () => void;
class Clock {
  time = 0;
  playing = false;
  duration = 0;
  loop = true;
  audio: HTMLAudioElement | null = null;
  music: HTMLAudioElement | null = null;
  private last = 0;
  private listeners = new Set<L>();
  private raf = 0;

  subscribe(l: L) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  setAudio(a: HTMLAudioElement | null) {
    this.audio = a;
  }

  play() {
    if (this.playing || this.duration <= 0) return;
    if (this.time >= this.duration - 0.02) this.seek(0);
    this.playing = true;
    this.last = performance.now();
    if (this.audio && this.time < this.audio.duration) {
      this.audio.currentTime = this.time;
      this.audio.play().catch(() => {});
    }
    if (this.music) {
      this.music.currentTime = this.time % (this.music.duration || 1e9);
      this.music.play().catch(() => {});
    }
    const tick = () => {
      if (!this.playing) return;
      const now = performance.now();
      if (this.audio && !this.audio.paused && !this.audio.ended) this.time = this.audio.currentTime;
      else this.time += (now - this.last) / 1000;
      this.last = now;
      if (this.time >= this.duration) {
        if (this.loop) {
          this.seek(0);
          if (this.audio) this.audio.play().catch(() => {});
          if (this.music) this.music.play().catch(() => {});
        } else {
          this.time = this.duration;
          this.pause();
        }
      }
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    this.music?.pause();
    this.emit();
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  seek(t: number) {
    this.time = Math.max(0, Math.min(t, this.duration || t));
    if (this.audio) this.audio.currentTime = Math.min(this.time, this.audio.duration || this.time);
    if (this.music && this.music.duration) this.music.currentTime = this.time % this.music.duration;
    this.emit();
  }
}

export const clock = new Clock();

export function useClock() {
  const [, set] = useState(0);
  useEffect(() => clock.subscribe(() => set((n) => (n + 1) % 1e9)), []);
  return clock;
}
