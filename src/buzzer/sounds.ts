import { BuzzerSound } from './types';

let audio: AudioContext | null = null;

export function enableBuzzerAudio(): void {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* The game remains usable on browsers without Web Audio. */ }
}

/** Original synthesized effects: no sound files or third-party media are required. */
export function playBuzzerSound(sound: BuzzerSound): void {
  if (!audio || audio.state !== 'running') return;
  const notes: Record<BuzzerSound, number[]> = {
    classic: [190, 150], horn: [220, 277, 330], laser: [1000, 520, 180],
    duck: [490, 330, 420], boing: [170, 510, 240], siren: [450, 800, 450, 800],
    arcade: [523, 659, 784, 1047], pop: [700, 180],
  };
  const frequencies = notes[sound] || notes.classic;
  const step = sound === 'siren' ? 0.12 : 0.075;
  const start = audio.currentTime;
  frequencies.forEach((frequency, index) => {
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = sound === 'horn' || sound === 'arcade' ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, start + index * step);
    gain.gain.setValueAtTime(0, start + index * step);
    gain.gain.linearRampToValueAtTime(0.08, start + index * step + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, start + (index + 1) * step);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start + index * step);
    oscillator.stop(start + (index + 1) * step + 0.01);
  });
}
